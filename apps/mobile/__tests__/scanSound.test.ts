import { playScanBeep } from '@/lib/scanSound';

const audio = jest.requireMock('expo-audio') as { createAudioPlayer: jest.Mock; setAudioModeAsync: jest.Mock; __player: { play: jest.Mock; seekTo: jest.Mock } };

describe('scan beep', () => {
  it('creates one player, stays silent in silent mode, and rewinds + plays on every call', () => {
    playScanBeep();
    playScanBeep();
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: false }));
    expect(audio.__player.play).toHaveBeenCalledTimes(2);
    expect(audio.__player.seekTo).toHaveBeenCalledWith(0);
  });
  it('never throws when audio fails', () => {
    audio.__player.play.mockImplementationOnce(() => {
      throw new Error('no audio');
    });
    expect(() => playScanBeep()).not.toThrow();
  });
});
