/**
 * useTTS — Text-to-speech via SpeechSynthesis API.
 * Extracted from ChatPanel.
 */
import { useState, useCallback } from 'react';

export function useTTS(ttsEnabled: boolean) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speakText = useCallback((text: string) => {
    if (!ttsEnabled || !text) return;

    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' (code block) ')
      .replace(/`[^`]+`/g, (match) => match.slice(1, -1))
      .replace(/#{1,6}\s/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();

    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('David') || v.name.includes('Zira') || v.name.includes('Microsoft'));
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [ttsEnabled]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return { isSpeaking, speakText, stopSpeaking };
}
