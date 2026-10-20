import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// 80 ms 1320 Hz sine generated for this app (assets/scan-beep.wav, no third-party audio).
const BEEP = require('../../assets/scan-beep.wav') as number;

let player: AudioPlayer | null = null;

/**
 * Short confirmation beep. Never throws and never blocks the camera. `playsInSilentMode: false` keeps it quiet when the
 * phone is on silent; it mixes with other audio instead of stopping it.
 */
export function playScanBeep(): void {
  try {
    if (!player) {
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
      player = createAudioPlayer(BEEP);
    }
    void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    player = null; // try again on the next read
  }
}
