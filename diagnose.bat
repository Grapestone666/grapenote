@echo off
echo ========================================
echo   GrapeNote Desktop Embed Diagnostic
echo ========================================
echo.

echo [1] Checking csc.exe ...
set CSC=
if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
    set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
    echo    FOUND: %CSC%
) else if exist "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" (
    set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
    echo    FOUND: %CSC%
) else (
    echo    NOT FOUND - .NET Framework missing
    pause
    exit /b 1
)
echo.

echo [2] Writing diagnostic C# code ...
> "%TEMP%\gn-diag.cs" (
echo using System;
echo using System.Runtime.InteropServices;
echo class Diag {
echo     [DllImport("user32.dll"^)] static extern IntPtr FindWindow(string c, string w^);
echo     [DllImport("user32.dll"^)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w^);
echo     [DllImport("user32.dll"^)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, IntPtr l, uint f, uint t, out IntPtr r^);
echo     [DllImport("user32.dll"^)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n^);
echo     static void Main(^) {
echo         Console.WriteLine("--- Desktop Window Hierarchy ---"^);
echo         IntPtr progman = FindWindow("Progman", null^);
echo         Console.WriteLine("Progman: " + progman.ToInt64(^)^);
echo         if (progman == IntPtr.Zero^) { Console.WriteLine("ERROR: Progman not found"^); return; }
echo         IntPtr r;
echo         SendMessageTimeout(progman, 0x052C, UIntPtr.Zero, IntPtr.Zero, 0, 1000, out r^);
echo         Console.WriteLine("Sent 0x052C, result: " + r.ToInt64(^)^);
echo         Console.WriteLine(^);
echo         Console.WriteLine("--- Enumerating WorkerW windows ---"^);
echo         IntPtr w = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null^);
echo         int count = 0;
echo         IntPtr targetW = IntPtr.Zero;
echo         while (w != IntPtr.Zero^) {
echo             count++;
echo             IntPtr dv = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null^);
echo             bool hasDV = dv != IntPtr.Zero;
echo             Console.WriteLine("  WorkerW #" + count + ": " + w.ToInt64(^) + (hasDV ? " [has SHELLDLL_DefView]" : ""^)^);
echo             if (hasDV^) {
echo                 IntPtr next = FindWindowEx(IntPtr.Zero, w, "WorkerW", null^);
echo                 if (next != IntPtr.Zero^) {
echo                     Console.WriteLine("  -> Next WorkerW (TARGET^): " + next.ToInt64(^)^);
echo                     targetW = next;
echo                 }
echo             }
echo             w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null^);
echo         }
echo         Console.WriteLine(^);
echo         Console.WriteLine("Total WorkerW found: " + count^);
echo         Console.WriteLine("Target WorkerW: " + (targetW != IntPtr.Zero ? targetW.ToInt64(^).ToString(^) : "NONE"^)^);
echo         Console.WriteLine(^);
echo         IntPtr dv2 = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null^);
echo         Console.WriteLine("SHELLDLL_DefView under Progman: " + (dv2 != IntPtr.Zero ? dv2.ToInt64(^).ToString(^) : "NONE"^)^);
echo         Console.WriteLine(^);
echo         if (targetW == IntPtr.Zero^) {
echo             Console.WriteLine("!! No target WorkerW found."^);
echo             Console.WriteLine("!! Try: SetParent to Progman directly."^);
echo         } else {
echo             Console.WriteLine("OK: Target WorkerW found, SetParent should work."^);
echo         }
echo     }
echo }
)
echo    Done.
echo.

echo [3] Compiling ...
"%CSC%" /nologo /optimize /out:"%TEMP%\gn-diag.exe" "%TEMP%\gn-diag.cs" 2>&1
if errorlevel 1 (
    echo    Compile FAILED
    pause
    exit /b 1
)
echo    OK.
echo.

echo [4] Running diagnostic ...
echo.
echo ----------------------------------------
"%TEMP%\gn-diag.exe"
echo ----------------------------------------
echo.

echo [5] Checking embed-helper.exe ...
if exist "%APPDATA%\grapenote\embed-helper.exe" (
    echo    embed-helper.exe EXISTS at %APPDATA%\grapenote\embed-helper.exe
) else if exist "%APPDATA%\GrapeNote\embed-helper.exe" (
    echo    embed-helper.exe EXISTS at %APPDATA%\GrapeNote\embed-helper.exe
) else (
    echo    embed-helper.exe NOT FOUND in AppData
)
echo.

echo Done. Please send the output above to Claude.
pause
