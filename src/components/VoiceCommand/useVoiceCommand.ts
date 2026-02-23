/**
 * useVoiceCommand — Voice command system for guIDE.
 * Records audio → Whisper STT → LLM command parsing → dispatches IDE actions.
 * 
 * Supports commands: open file, go to line, search, run terminal command,
 * new file, save, toggle terminal/sidebar, git operations, ask AI, etc.
 */
import { useState, useRef, useCallback } from 'react';

export interface VoiceCommandResult {
  action: string;
  query?: string;
  line?: number;
  command?: string;
  message?: string;
  find?: string;
  replace?: string;
  text?: string;
  name?: string;
}

interface UseVoiceCommandOptions {
  onCommand: (command: VoiceCommandResult) => void;
  onTranscription?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceCommand({ onCommand, onTranscription, onError }: UseVoiceCommandOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
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
          setIsRecording(false);
          return;
        }

        setIsProcessing(true);
        try {
          // Step 1: Transcribe audio via Whisper
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );

          const transcribeResult = await window.electronAPI?.transcribeAudio?.(base64);
          if (!transcribeResult?.success || !transcribeResult.text?.trim()) {
            onError?.('Could not transcribe audio. Check your Groq API key.');
            setIsProcessing(false);
            return;
          }

          const transcription = transcribeResult.text.trim();
          setLastTranscription(transcription);
          onTranscription?.(transcription);

          // Step 2: Parse command via LLM
          const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
          const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';
          const commandResult = await window.electronAPI?.voiceCommand?.({
            transcription,
            ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
          });

          if (commandResult?.success && commandResult.command) {
            onCommand(commandResult.command as VoiceCommandResult);
          } else {
            // Fallback: treat as chat message
            onCommand({ action: 'ask-ai', message: transcription });
          }
        } catch (e: any) {
          onError?.(e.message || 'Voice command failed');
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.onerror = () => {
        stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current = null;
        setIsRecording(false);
        onError?.('Audio recording failed');
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
    } catch {
      onError?.('Microphone access denied. Please check permissions.');
    }
  }, [isRecording, stopRecording, onCommand, onTranscription, onError]);

  return {
    isRecording,
    isProcessing,
    lastTranscription,
    toggleRecording,
    stopRecording,
  };
}
