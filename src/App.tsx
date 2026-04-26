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
  const [error, setError] = useState<string | null>(null);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } 
      });
      
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaStreamSource(stream);

      // Izolacja częstotliwości (Według zaleceń inżynieryjnych: 300 Hz - 3400 Hz dla głosu)
      
      // Filtr Highpass - odcina ryczenie i niskie dudnienie < 300Hz
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 300;
      highpass.Q.value = 1;

      // Filtr Lowpass - odcina syczenie i wysokie szumy > 3400Hz
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3400;
      lowpass.Q.value = 1;

      // Wzmocnienie sygnału
      const gainNode = ctx.createGain();
      gainNode.gain.value = gainLevel;
      gainNodeRef.current = gainNode;

      // Łączenie węzłów
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gainNode);
      gainNode.connect(ctx.destination);

      audioCtxRef.current = ctx;
      streamRef.current = stream;
      setIsListening(true);
    } catch (err: any) {
      console.error(err);
      setError("Nie udało się uzyskać dostępu do mikrofonu. Upewnij się, że nadałeś uprawnienia.");
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
    setIsListening(false);
  };

  // Zaktualizuj gain dynamicznie gdy suwak się rusza
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(gainLevel, audioCtxRef.current.currentTime, 0.05);
    }
  }, [gainLevel]);

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
                <h2 className="text-xl font-bold text-white mb-2">Symulacja Przetwarzania W Locie</h2>
                <p className="text-emerald-200/70 text-sm max-w-3xl leading-relaxed">
                  Zgodnie z koncepcją, poniższe narzędzie symuluje "Izolację Częstotliwości". Pobiera dźwięk z mikrofonu Twojego urządzenia, aplikuje pasmowo-przepustowy filtr ograniczający szum $300\text{ Hz}$ do $3400\text{ Hz}$ (częstotliwości ludzkiego głosu) i wzmacnia go.
                </p>
                
                <div className="mt-6 flex items-start gap-4 bg-orange-950/50 border border-orange-900/50 p-4 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-orange-400 font-bold text-sm">OSTRZEŻENIE O SPRZĘŻENIU (FEEDBACK LOOP)</h3>
                    <p className="text-orange-300/80 text-xs mt-1">
                      Nie włączaj tej funkcji używając głośników komputerowych. Dźwięk mikrofonu wyjdzie na głośniki i wejdzie z powrotem do mikrofonu niszcząc Ci słuch. <strong>ZAŁÓŻ SŁUCHAWKI PRZED URUCHOMIENIEM!</strong>
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Control Panel */}
                <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-8 flex flex-col items-center justify-center min-h-[300px]">
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
                  <p className="mt-8 text-neutral-400 font-medium font-sans">
                    {isListening ? "PRZETWARZANIE AKTYWNE" : "URUCHOM SYMULATOR"}
                  </p>
                  {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}
                </div>

                {/* Settings Panel */}
                <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-8 space-y-8">
                  <div className="flex items-center gap-3 text-white font-bold pb-4 border-b border-neutral-800">
                    <Settings2 className="w-5 h-5 text-neutral-400" /> Parametry filtru DSP
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Filtr górnoprzepustowy (High-pass)</span>
                      <span className="text-emerald-400 font-bold">300 Hz</span>
                    </div>
                    <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/30 w-full rounded-full"></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Filtr dolnoprzepustowy (Low-pass)</span>
                      <span className="text-emerald-400 font-bold">3400 Hz</span>
                    </div>
                    <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/30 w-full rounded-full"></div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4">
                    <div className="flex justify-between items-center text-sm mb-2">
                      <span className="flex items-center gap-2 text-neutral-400">
                        <Volume2 className="w-4 h-4" /> Wzmocnienie wokalu (Gain)
                      </span>
                      <span className="text-emerald-400 font-bold">{gainLevel.toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="5" 
                      step="0.1" 
                      value={gainLevel}
                      onChange={(e) => setGainLevel(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500 bg-neutral-800 rounded-lg appearance-none h-2"
                    />
                    <p className="text-xs text-neutral-500 italic mt-2">Działa w czasie rzeczywistym. Dostosuj głośność mowy.</p>
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