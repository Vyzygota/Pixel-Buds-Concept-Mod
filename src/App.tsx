import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Headphones, 
  Mic, 
  MicOff, 
  Code2, 
  Cpu, 
  AlertTriangle,
  Play,
  Square,
  Settings2,
  Volume2
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'android' | 'dsp'>('simulator');
  
  // Audio Simulator State
  const [isListening, setIsListening] = useState(false);
  const [gainLevel, setGainLevel] = useState(2.0); // Wzmocnienie domyślne: 2x
  const [useAEC, setUseAEC] = useState(true); // Ochrona przed sprzężeniem domyślnie włączona
  const [error, setError] = useState<string | null>(null);
  
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  type EQPreset = 'voice-clarity' | 'noise-reduction' | 'full-spectrum';
  const [eqPreset, setEqPreset] = useState<EQPreset>('voice-clarity');

  const PRESETS = {
    'voice-clarity': { name: 'Voice Clarity (Wydobycie mowy z tła)', hp: 300, lp: 2800, eqFreq: 1200, eqGain: 4, compRatio: 12, compThresh: -45 },
    'noise-reduction': { name: 'Noise Reduction (Silne tłumienie szumów)', hp: 400, lp: 2000, eqFreq: 1000, eqGain: 2, compRatio: 20, compThresh: -50 },
    'full-spectrum': { name: 'Full Spectrum (Pełny zakres / muzyka)', hp: 50, lp: 8000, eqFreq: 2000, eqGain: 0, compRatio: 4, compThresh: -35 }
  };

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const filtersRef = useRef<{ highpass: BiquadFilterNode; lowpass: BiquadFilterNode; eq: BiquadFilterNode; compressor: DynamicsCompressorNode } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number>(null);

  useEffect(() => {
    // Enum devices to prevent 'Monitor' loop
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); // Request perm to get labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error("Nie udało się pobrać listy urządzeń.", err);
      }
    };
    getDevices();
  }, []);

  const drawVisualizer = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(10, 10, 10, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10b981'; // emerald-500
    ctx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    if (isListening) {
      requestRef.current = requestAnimationFrame(drawVisualizer);
    }
  };

  const toggleMic = async () => {
    if (isListening) {
      stopAudio();
    } else {
      startAudio();
    }
  };

  const startAudio = async () => {
    try {
      setError(null);
      
      // Request mic permissions
      let stream: MediaStream;
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: useAEC,
          noiseSuppression: useAEC,
          autoGainControl: false,
        };
        
        if (selectedDeviceId) {
          constraints.deviceId = { exact: selectedDeviceId };
        }

        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: constraints 
        });
      } catch (err) {
        console.warn("Specific constraints failed, trying default audio...", err);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor({ latencyHint: 'interactive' });
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      const source = ctx.createMediaStreamSource(stream);

      // Izolacja częstotliwości (Według zaleceń inżynieryjnych: 300 Hz - 3400 Hz dla głosu)
      
      const p = PRESETS[eqPreset];
      
      // Filtr Highpass - odcina ryczenie i niskie dudnienie
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = p.hp;
      highpass.Q.value = 0.707;

      // Filtr Lowpass - odcina syczenie i wysokie szumy
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = p.lp;
      lowpass.Q.value = 0.707;

      // Peaking EQ - wzmocnienie "prezencji" Głosu (lepsze wybijanie się z szumu)
      const presenceEQ = ctx.createBiquadFilter();
      presenceEQ.type = 'peaking';
      presenceEQ.frequency.value = p.eqFreq;
      presenceEQ.Q.value = 1.0;
      presenceEQ.gain.value = p.eqGain;

      // Kompresor dynamiki - wyrównuje głośność, wyciąga ciche dźwięki i spłaszcza głośne
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = p.compThresh;
      compressor.knee.value = 30;
      compressor.ratio.value = p.compRatio;
      compressor.attack.value = 0.01; // Szybki atak
      compressor.release.value = 0.25;
      
      filtersRef.current = { highpass, lowpass, eq: presenceEQ, compressor };

      // Wzmocnienie sygnału
      const gainNode = ctx.createGain();
      gainNode.gain.value = gainLevel;
      gainNodeRef.current = gainNode;
      
      // Analizator dla wizualizacji (opcjonalnie)
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // Łączenie węzłów (Łańcuch DSP: source -> highpass -> lowpass -> EQ -> compressor -> gain -> analyser -> destination)
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(presenceEQ);
      presenceEQ.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(analyser); // wizualizacja
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      streamRef.current = stream;
      setIsListening(true);
      
      // Rozpocznij rysowanie
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(drawVisualizer);
    } catch (err: any) {
      console.error(err);
      
      let errorMessage = "Wystąpił nieoczekiwany błąd podczas dostępu do mikrofonu.";
      
      if (err.name === 'NotAllowedError') {
        errorMessage = "Brak uprawnień. Przeglądarka zablokowała dostęp do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki.";
      } else if (err.name === 'NotFoundError') {
        errorMessage = "Nie znaleziono mikrofonu. Upewnij się, że mikrofon jest podłączony i aktywny.";
      } else if (err.name === 'NotReadableError') {
        errorMessage = "Mikrofon jest używany przez inną aplikację lub wystąpił błąd sprzętowy.";
      } else if (err.name === 'OverconstrainedError') {
        errorMessage = "Nie udało się spełnić wymagań sprzętowych urządzenia audio.";
      } else if (err.name === 'NotSupportedError') {
         errorMessage = "Twoja przeglądarka nie obsługuje wymaganych funkcji Audio.";
      } else if (err.message) {
        errorMessage = `Błąd: ${err.message}`;
      }

      setError(errorMessage);
    }
  };

  const stopAudio = () => {
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(console.error);
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    filtersRef.current = null;
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    setIsListening(false);
  };

  // Zaktualizuj gain dynamicznie gdy suwak się rusza
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(gainLevel, audioCtxRef.current.currentTime, 0.05);
    }
  }, [gainLevel]);

  // Zaktualizuj parametry DSP dynamicznie przy zmianie profilu
  useEffect(() => {
    if (filtersRef.current && audioCtxRef.current) {
      const p = PRESETS[eqPreset];
      const t = audioCtxRef.current.currentTime;
      filtersRef.current.highpass.frequency.setTargetAtTime(p.hp, t, 0.1);
      filtersRef.current.lowpass.frequency.setTargetAtTime(p.lp, t, 0.1);
      filtersRef.current.eq.frequency.setTargetAtTime(p.eqFreq, t, 0.1);
      filtersRef.current.eq.gain.setTargetAtTime(p.eqGain, t, 0.1);
      filtersRef.current.compressor.threshold.setTargetAtTime(p.compThresh, t, 0.1);
      filtersRef.current.compressor.ratio.setTargetAtTime(p.compRatio, t, 0.1);
    }
  }, [eqPreset]);

  // Clean up na wyjściu
  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-300 font-mono flex flex-col">
      {/* Header */}
      <header className="bg-neutral-900 border-b border-neutral-800 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <Headphones className="w-7 h-7 text-emerald-500" />
            Project: Conversation Boost
          </h1>
          <p className="text-neutral-500 text-sm mt-1">Po-C & Documentation / Pixel Buds Concept</p>
        </div>
        <div className="flex bg-neutral-950 rounded-lg border border-neutral-800 p-1">
          <button 
            onClick={() => setActiveTab('simulator')}
            className={cn("px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2", activeTab === 'simulator' ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-300")}
          >
            <Mic className="w-4 h-4" /> Live Web DSP
          </button>
          <button 
            onClick={() => setActiveTab('android')}
            className={cn("px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2", activeTab === 'android' ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-300")}
          >
            <Code2 className="w-4 h-4" /> Android App Code
          </button>
          <button 
            onClick={() => setActiveTab('dsp')}
            className={cn("px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2", activeTab === 'dsp' ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-300")}
          >
            <Cpu className="w-4 h-4" /> Architektura H/W
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8 max-w-6xl w-full mx-auto">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: SIMULATOR */}
          {activeTab === 'simulator' && (
            <motion.div
              key="simulator"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-8"
            >
              <div className="bg-emerald-950/30 border border-emerald-900/50 p-6 rounded-2xl">
                <h2 className="text-xl font-bold text-white mb-2">Symulacja Przetwarzania W Locie (DSP Audio Pipeline)</h2>
                <p className="text-emerald-200/70 text-sm max-w-3xl leading-relaxed">
                  Zaktualizowany łańcuch filtrujący symuluje "Izolację Tła". Pobiera dźwięk z mikrofonu Twojego urządzenia, następnie aplikuje kolejno: 
                  <strong>(1)</strong> filtr pasmowy 300Hz-3400Hz (odcina buczenie i syk), 
                  <strong>(2)</strong> filtr Peaking EQ wzmacniający częstotliwości 1500Hz (tam gdzie ludzki głos jest najbardziej czytelny), 
                  <strong>(3)</strong> Kompresor Dynamiki wyciągający najcichsze tony i spłaszczający głośne hałasy, oraz 
                  <strong>(4)</strong> silne Wzmocnienie (Gain) podbijające ostateczny efekt bez przesteru.
                </p>
                
                <div className="mt-6 flex flex-col gap-3">
                  <div className="flex items-start gap-4 bg-orange-950/50 border border-orange-900/50 p-4 rounded-xl">
                    <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <h3 className="text-orange-400 font-bold text-sm">"Monitor of..." Pętla Sprzętowa (Piszczenie w Linuksie!)</h3>
                      <p className="text-orange-300/80 text-xs mt-1">
                        Jeśli sprzężenie błyskawicznie narasta do pisku, oznacza to, że przeglądarka zamiast fizycznego mikrofonu z laptopa przechwytuje tzw. <strong>"Monitor of WH-1000XM4"</strong> (lub podobny). W systemach Linux (PipeWire / PulseAudio) "Monitor" to wirtualny mikrofon, który nagrywa to, co leci na słuchawki. W efekcie program w nieskończoność sam nasłuchuje własnego wyjścia tworząc natychmiastowe sprzężenie zwrotne.
                      </p>
                      <ul className="text-orange-300/80 text-xs list-disc pl-4 space-y-1 mt-2">
                        <li><strong>ROZWIĄZANIE NAJWAŻNIEJSZE:</strong> Użyj rozwijanej listy poniżej (w głównym panelu) i wybierz fizyczny mikrofon z laptopa (np. <i>Ryzen HD Audio Controller</i>), a NIE opcji typu "Monitor of...".</li>
                        <li>Sprawdź też w ustawieniach "Dźwięku", by domyślnym wejściem była karta sprzętowa.</li>
                      </ul>
                      <div className="mt-3 pt-3 border-t border-orange-900/50 flex items-center justify-between">
                        <span className="text-sm font-bold text-orange-400">Tłumienie sprzężeń (AEC)</span>
                        <button 
                          onClick={() => {
                            setUseAEC(!useAEC);
                            if (isListening) {
                              stopAudio(); // wymusza restart by zaaplikować nowe ustawienia
                              setTimeout(() => alert("Kliknij 'Play', aby uruchomić ponownie ze zmienionym trybem AEC."), 300);
                            }
                          }}
                          className={cn("px-3 py-1 rounded text-xs font-bold transition-colors", useAEC ? "bg-emerald-500/20 text-emerald-400" : "bg-neutral-800 text-neutral-400")}
                        >
                          {useAEC ? "WŁĄCZONE" : "WYŁĄCZONE"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 bg-blue-950/50 border border-blue-900/50 p-4 rounded-xl">
                    <Headphones className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <h3 className="text-blue-400 font-bold text-sm">Masz Bluetooth i słyszysz pikanie / spadek jakości? (A2DP vs HFP)</h3>
                      <p className="text-blue-300/80 text-sm">
                        Wybór profilu Bluetooth (widoczny na Twoim zrzucie ekranu) to klucz do problemu:
                      </p>
                      <ul className="text-blue-300/80 text-xs list-disc pl-4 space-y-1">
                        <li><strong>A2DP (np. kodek AAC/SBC)</strong>: Wysoka jakość dźwięku, ale <strong>tylko odtwarzanie (jednokierunkowe)</strong>. Słuchawki nie udostępniają wtedy mikrofonu.</li>
                        <li><strong>HSP/HFP (np. kodek mSBC/CVSD)</strong>: Obsługa mikrofonu w słuchawkach, ale za to <strong>drastyczny spadek jakości dźwięku</strong> (tzw. "jakość rozmowy telefonicznej").</li>
                      </ul>
                      <p className="text-blue-300/80 text-xs mt-2 border-t border-blue-900/50 pt-2">
                        <strong>Rozwiązanie:</strong> Pikanie ("bip bip") to moment, w którym sprzęt zrywa połączenie muzyczne by przejść w tryb rozmowy HSP/HFP (bo przeglądarka zażądała mikrofonu). 
                        Aby to obejść i zachować jakość: zostaw profil słuchawek na <strong>Odtwarzanie o wysokiej dokładności (A2DP, AAC)</strong>, ale w ustawieniach "Wejścia" / "Nagrywania" w systemie wymuś <strong>mikrofon wbudowany w laptopa</strong> (lub podłączony po USB). Nasz koncept zakłada i tak użycie zewnętrznego mikrofonu (kierunkowego z telefonu/laptopa), więc to idealnie pasuje!
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Control Panel */}
                <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-8 flex flex-col items-center justify-center min-h-[350px]">
                  <button
                    onClick={toggleMic}
                    className={cn(
                      "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl relative group",
                      isListening 
                        ? "bg-red-500/10 text-red-500 border-2 border-red-500/50 hover:bg-red-500/20 shadow-red-500/20" 
                        : "bg-emerald-500/10 text-emerald-500 border-2 border-emerald-500/50 hover:bg-emerald-500/20 shadow-emerald-500/20"
                    )}
                  >
                    {isListening ? (
                      <div className="absolute inset-0 rounded-full animate-ping border-2 border-red-500/30"></div>
                    ) : null}
                    
                    {isListening ? <Square className="w-12 h-12 fill-current" /> : <Play className="w-12 h-12 fill-current ml-2" />}
                  </button>
                  <p className="mt-8 text-neutral-400 font-medium font-sans mb-4">
                    {isListening ? "PRZETWARZANIE AKTYWNE" : "URUCHOM SYMULATOR"}
                  </p>
                  
                  {/* Przełącznik urządzeń */}
                  <div className="w-full mb-6">
                    <label className="block text-xs font-bold text-neutral-500 mb-2">WYBIERZ MIKROFON (Omiń Pętlę "Monitor of..."):</label>
                    <select 
                      className="w-full bg-neutral-950 border border-neutral-700 text-neutral-300 text-sm rounded-lg p-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      value={selectedDeviceId}
                      onChange={(e) => {
                        setSelectedDeviceId(e.target.value);
                        if (isListening) {
                          stopAudio();
                          setTimeout(() => alert("Wybrałeś inny mikrofon. Uruchom ponownie przyciskiem Play."), 200);
                        }
                      }}
                    >
                      {audioDevices.length === 0 && <option value="">Zezwól na mikrofon by załadować listę...</option>}
                      {audioDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Mikrofon / Wejście ${device.deviceId.substring(0,6)}...`}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="w-full h-16 bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800 relative">
                    {!isListening && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">Oczekiwanie na sygnał audio</div>
                    )}
                    <canvas ref={canvasRef} className="w-full h-full" width={300} height={64} />
                  </div>

                  {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}
                </div>

                {/* Settings Panel */}
                <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-8 space-y-8">
                  <div className="flex items-center gap-3 text-white font-bold pb-4 border-b border-neutral-800">
                    <Settings2 className="w-5 h-5 text-neutral-400" /> Profil Przetwarzania (DSP Preset)
                  </div>
                  
                  {/* Przełącznik Profilu EQ */}
                  <div className="w-full">
                    <select 
                      className="w-full bg-neutral-950 border border-neutral-700 text-emerald-400 font-medium text-sm rounded-lg p-3 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      value={eqPreset}
                      onChange={(e) => setEqPreset(e.target.value as EQPreset)}
                    >
                      {Object.entries(PRESETS).map(([key, data]) => (
                        <option key={key} value={key}>
                          {data.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">High-pass / Low-pass (Cutoff)</span>
                      <span className="text-emerald-400 font-bold">{PRESETS[eqPreset].hp}Hz - {(PRESETS[eqPreset].lp / 1000).toFixed(1)}kHz</span>
                    </div>
                    <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden flex">
                      <div className="bg-neutral-800/10 h-full transition-all duration-300" style={{ width: `${(PRESETS[eqPreset].hp / 500) * 15}%` }}></div>
                      <div className="bg-emerald-500/30 h-full rounded-full transition-all duration-300" style={{ flex: 1 }}></div>
                      <div className="bg-neutral-800/10 h-full transition-all duration-300" style={{ width: `${Math.max(0, 100 - (PRESETS[eqPreset].lp / 8000) * 100)}%` }}></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Peaking EQ (Prezencja / Wokal)</span>
                      <span className="text-emerald-400 font-bold">{PRESETS[eqPreset].eqFreq} Hz ({PRESETS[eqPreset].eqGain > 0 ? '+' : ''}{PRESETS[eqPreset].eqGain}dB)</span>
                    </div>
                    <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden relative">
                      <div className="absolute inset-0 bg-neutral-800"></div>
                      <div 
                        className="absolute bg-emerald-400 h-full rounded-full blur-[1px] transition-all duration-300" 
                        style={{ 
                          left: `${(PRESETS[eqPreset].eqFreq / 4000) * 100}%`, 
                          width: '20%', 
                          opacity: PRESETS[eqPreset].eqGain > 0 ? 1 : 0.2 
                        }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Kompresor Dynamiki (Zrównanie)</span>
                      <span className="text-emerald-400 font-bold">Ratio {PRESETS[eqPreset].compRatio}:1</span>
                    </div>
                    <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden relative">
                      <div className="h-full bg-blue-500/50 rounded-full opacity-80 transition-all duration-300" style={{ width: `${(PRESETS[eqPreset].compRatio / 25) * 100}%` }}></div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-neutral-800 mt-4">
                    <div className="flex justify-between items-center text-sm mb-2">
                      <span className="flex items-center gap-2 text-neutral-400">
                        <Volume2 className="w-4 h-4" /> Główne wzmocnienie (Gain Boost)
                      </span>
                      <span className="text-emerald-400 font-bold">{gainLevel.toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="20" 
                      step="0.5" 
                      value={gainLevel}
                      onChange={(e) => setGainLevel(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500 bg-neutral-800 rounded-lg appearance-none h-2"
                    />
                    <p className="text-xs text-neutral-500 italic mt-2">
                      Dzięki nowemu kompresorowi i EQ możesz znacznie silniej podbić głośność bez całkowitego przesterowania.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: ANDROID */}
          {activeTab === 'android' && (
            <motion.div
              key="android"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-6"
            >
              <div className="prose prose-invert prose-emerald max-w-none">
                <p>
                  Ponieważ nie mamy dostępu do sprzętowego chipsetu Tensor A1, poniżej znajduje się zarys (Proof of Concept) logiki w języku Kotlin na Androida. Aplikacja pobiera nieskompresowany strumień z mikrofonu kierunkowego telefonu, filtruje go w oparciu o bibliotekę zewnętrzną lub algorytm AudioRecord i przesyła prosto na słuchawki BT (klasa AudioTrack), akceptując ok. 50-150ms opóźnienia Bluetooth.
                </p>
              </div>

              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-blue-500/10 rounded-xl blur-md group-hover:blur-xl transition-all"></div>
                <pre className="relative bg-[#0d1117] border border-neutral-800 p-6 rounded-xl overflow-x-auto text-sm leading-relaxed text-neutral-300">
<code className="language-kotlin">{`import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder

class ConversationBoostService {

    private val sampleRate = 48000
    private val bufferSize = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )
    
    private var isBoosting = false

    fun startListeningAndRoutingContext() {
        isBoosting = true
        
        // 1. Zdefiniowanie wejścia (Kierunkowy mikrofon telefonu)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )

        // 2. Zdefiniowanie wyjścia muzycznego (Bluetooth słuchawki - niska latencja)
        val audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferSize)
            .build()

        audioRecord.startRecording()
        audioTrack.play()

        val audioBuffer = ShortArray(bufferSize)

        // 3. Wątek roboczy do przechwytywania i przepuszczania dźwięku w czasie rzeczywistym
        Thread {
            while (isBoosting) {
                val readResult = audioRecord.read(audioBuffer, 0, audioBuffer.size)
                if (readResult > 0) {
                    // TODO: Tutaj aplikujemy Math/DSP:
                    // applyBandpassFilter(audioBuffer, 300f, 3400f)
                    // applyRNNoiseDenoise(audioBuffer)
                    // applyVocalGain(audioBuffer, 2.0f)
                    
                    audioTrack.write(audioBuffer, 0, readResult)
                }
            }
            
            // Czyszczenie zasobów po zakończeniu
            audioRecord.stop()
            audioRecord.release()
            audioTrack.stop()
            audioTrack.release()
        }.start()
    }

    fun stopOperation() {
        isBoosting = false
    }
}`}</code>
                </pre>
              </div>
            </motion.div>
          )}

          {/* TAB 3: DSP ARCHITECTURE */}
          {activeTab === 'dsp' && (
            <motion.div
              key="dsp"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-6"
            >
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 prose prose-invert prose-neutral max-w-none">
                <h2 className="text-white border-b border-neutral-800 pb-4 flex items-center gap-2">
                  <Cpu className="text-emerald-500" /> Wyzwania Hardware & Firmware (Pixel Buds Pro 2)
                </h2>
                
                <div className="grid md:grid-cols-2 gap-8 mt-6">
                  <div>
                    <h3 className="text-emerald-400 font-sans text-sm tracking-wide font-bold uppercase mt-0">1. Ściana Zamkniętego Kodu</h3>
                    <p className="text-neutral-400">
                      Oprogramowanie działające bezpośrednio na słuchawkach jest w pełni zamknięte (closed-source) i podpisane cyfrowo przez Google. Tylko inżynierowie w Mountain View mają dostęp do środowiska programistycznego procesora <strong>Tensor A1</strong>. Zewnętrzni programiści nie mogą nadpisać działania mikrofonów słuchawek w trybie Transparency.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-emerald-400 font-sans text-sm tracking-wide font-bold uppercase mt-0">2. Beamforming (Kształtowanie Wiązki)</h3>
                    <p className="text-neutral-400">
                      Korzystając z API poziomu krzemu (Silicon Level), użyto by danych z 3 mikrofonów w każdej słuchawce. Analizując mikrosekundowe różnice docierania dźwięku do poszczególnych mikrofonów, można by było matematycznie "wyciąć" sygnał nadchodzący z boków i z tyłu obniżając stosunek sygnał/szum.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-emerald-400 font-sans text-sm tracking-wide font-bold uppercase mt-0">3. Izolacja częstotliwości</h3>
                    <p className="text-neutral-400">
                      Zastosowanie filtra pasmowo-przepustowego wzmacniającego ludzki głos (zazwyczaj przedział od 300 Hz do 3400 Hz). Zewnętrzny hałas (buczenie ulicy poniżej 300 Hz lub szum powyżej 3400 Hz) zostaje spłaszczony przez DSP przed wejściem przez przetworniki DAC do ucha.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-emerald-400 font-sans text-sm tracking-wide font-bold uppercase mt-0">4. Wymóg Niskiego Opóźnienia (Latency)</h3>
                    <p className="text-neutral-400">
                      Procesor Tensor A1 musi to przeliczyć w czasie góra 15-20 milisekund (Motion-to-Photon-like audio translation). Gdyby zajęło to dłużej, wystąpiłoby opóźnienie wizualno-dźwiękowe – widzisz ruch warg rozmówcy, ale głos dobiega "echo" z opóźnieniem. Nasze aplikacyjne obejście ma tę słabą stronę ze względu na Bluetooth.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}