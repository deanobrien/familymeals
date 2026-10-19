A leftover node process can lock sharp/libvips DLLs and break the next package build: use a fresh -BuildRoot.

Symptom: the packaging script (or pnpm install) fails deleting/overwriting a `@img/sharp-*` or libvips DLL in the build root because a dev server, test run or earlier build still has it loaded. Fix: stop node processes, or run `scripts\package-appservice.ps1 -BuildRoot C:\frbuild2` (any new short path). `-SkipInstall` reuses an existing build root's install.
