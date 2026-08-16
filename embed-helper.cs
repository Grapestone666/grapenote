using System;
using System.Runtime.InteropServices;

class EmbedHelper
{
    [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr c, IntPtr p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, uint v);
    [DllImport("user32.dll")] static extern uint GetWindowLong(IntPtr h, int i);

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2) { Console.WriteLine("ERR:usage"); return 1; }
            if (args[0] != "embed") { Console.WriteLine("ERR:unknown_cmd"); return 1; }
            long hwndVal;
            if (!long.TryParse(args[1], out hwndVal)) { Console.WriteLine("ERR:bad_hwnd"); return 1; }
            IntPtr ourHwnd = new IntPtr(hwndVal);

            IntPtr progman = FindWindow("Progman", null);
            if (progman == IntPtr.Zero) { Console.WriteLine("ERR:no_progman"); return 1; }

            IntPtr sr;
            SendMessageTimeout(progman, 0x052C, UIntPtr.Zero, IntPtr.Zero, 0, 1000, out sr);

            IntPtr target = IntPtr.Zero;
            IntPtr w = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
            while (w != IntPtr.Zero)
            {
                if (FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                { target = FindWindowEx(IntPtr.Zero, w, "WorkerW", null); break; }
                w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
            }
            if (target == IntPtr.Zero && FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                target = progman;

            if (target == IntPtr.Zero) { Console.WriteLine("ERR:no_target"); return 1; }

            uint style = GetWindowLong(ourHwnd, -16);
            SetWindowLong(ourHwnd, -16, (style & ~0x80000000u) | 0x40000000u);
            IntPtr prev = SetParent(ourHwnd, target);
            if (prev == IntPtr.Zero) { Console.WriteLine("ERR:setparent:" + Marshal.GetLastWin32Error()); return 1; }
            SetWindowPos(ourHwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0020 | 0x0010 | 0x0002 | 0x0001);

            Console.WriteLine("OK:parent=" + target.ToInt64());
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("ERR:" + ex.Message); return 1; }
    }
}
