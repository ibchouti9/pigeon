import { invoke, isDesktop, isIos } from '../lib/desktop';

/**
 * How much of this Mac a model may have.
 *
 * Mirrors `MachineMemory` in `src-tauri/src/machine.rs`. Two declarations of
 * one truth across a language boundary: if one changes, change the other.
 */
export interface MachineMemory {
  totalBytes: number;
  usableBytes: number;
  chip?: string;
}

const GB = 1e9;

/**
 * Usable AI memory in GB, or zero when it cannot be known.
 *
 * Zero rather than a guess. The web build has no way to survey the machine —
 * Safari exposes no memory API and the Tauri webview is Safari — and a picker
 * that assumed 16GB would confidently tell someone on an 8GB Air that a 9GB
 * model fits well. Zero makes the fit column disappear instead, and the
 * catalog falls back to ranking by what is already installed.
 */
export async function usableMemory(): Promise<{ gb: number; chip?: string }> {
  /*
   * iOS is excluded by name as well as by build. It is a native build and
   * passes `isDesktop`, but `machine_memory` shells out to `sysctl` and iOS
   * forbids spawning a process at all — so the command exists, compiles, and
   * fails at runtime. There is also nothing to size: no model runs beside the
   * app on a phone.
   */
  if (!isDesktop() || isIos()) return { gb: 0 };
  try {
    const memory = await invoke<MachineMemory | null>('machine_memory');
    if (!memory) return { gb: 0 };
    return { gb: memory.usableBytes / GB, chip: memory.chip };
  } catch {
    // An older build without the command, or a sysctl that refused. The
    // picker still works; it just stops claiming to know what fits.
    return { gb: 0 };
  }
}
