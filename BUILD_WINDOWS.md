# Build and download Malik POS for Windows

The Windows installer is built automatically by the GitHub Actions workflow on pushes to `main`.

1. Open the [Windows build workflow](https://github.com/findupto/Malik-POS-for-Computer/actions/workflows/windows-build.yml).
2. Open the newest completed run.
3. Under **Artifacts**, download `Malik-POS-Windows-Installer`.
4. Extract the downloaded ZIP and run `Malik-POS-Setup-1.0.0.exe`.

To build locally on Windows, install Node.js 22 or newer, open a terminal in the project folder, and run:

```powershell
npm install
npm run build:win
```

The installer will be created in the `release` folder. The installer is for 64-bit Windows (x64).
