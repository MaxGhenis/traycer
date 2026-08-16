import { create } from "zustand";

/**
 * One app-wide flag: an armed, visible screencast tile currently owns
 * keyboard input. The keybinding provider subscribes once and skips app
 * chords while this is set. A stuck true kills chords everywhere, so the
 * tile must clear it on every disarm path (revoke, hide, release, blur,
 * close).
 */
interface ScreencastArmedState {
  readonly armed: boolean;
  readonly setArmed: (armed: boolean) => void;
}

export const useScreencastArmedStore = create<ScreencastArmedState>((set) => ({
  armed: false,
  setArmed: (armed) =>
    set((state) => (state.armed === armed ? state : { armed })),
}));
