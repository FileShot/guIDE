/**
 * useVoiceInput — MediaRecorder + Groq Whisper speech-to-text.
 * Extracted from ChatPanel.
 */
import { useState, useRef, useCallback } from 'react';

interface VoiceInputCallbacks {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  addSystemMessage: (content: string) => void;
}

export function useVoiceInput({ setInput, addSystemMessage }: VoiceInputCallbacks) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current = null;

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (audioBlob.size < 1000) {
          setIsListening(false);
          return;
        }

        setIsTranscribing(true);
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );

          const result = await window.electronAPI?.transcribeAudio?.(base64);
          if (result?.success && result.text?.trim()) {
            const transcribedText = result.text.trim();
            setInput(prev => prev ? prev + ' ' + transcribedText : transcribedText);
          } else if (result?.error) {
            addSystemMessage(`[Warning] Transcription error: ${result.error}`);
          }
        } catch (e: any) {
          addSystemMessage(`[Warning] Transcription failed: ${e.message}`);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.onerror = () => {
        stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current = null;
        setIsListening(false);
        addSystemMessage('[Warning] Audio recording failed.');
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsListening(true);
    } catch (micError: any) {
      addSystemMessage('[Warning] Microphone access denied. Please check permissions.');
    }
  }, [isListening, stopListening, setInput, addSystemMessage]);

  return { isListening, isTranscribing, toggleListening, stopListening };
}
