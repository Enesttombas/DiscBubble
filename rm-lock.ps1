Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class RM {
  [StructLayout(LayoutKind.Sequential)] struct UP { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME t; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PI { public UP p; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string app; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string svc; public int type; public uint status; public uint sess; [MarshalAs(UnmanagedType.Bool)] public bool rs; }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string k);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nf, string[] f, uint na, UP[] a, uint ns, string[] s);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint n, [In,Out] PI[] info, out uint reasons);
  public static string Who(string file) {
    uint h; if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return "";
    try {
      if (RmRegisterResources(h, 1, new[] { file }, 0, null, 0, null) != 0) return "";
      uint need = 0, n = 0, r; int rc = RmGetList(h, out need, ref n, null, out r);
      if (rc != 234 || need == 0) return "";
      var info = new PI[need]; n = need; rc = RmGetList(h, out need, ref n, info, out r);
      if (rc != 0) return "";
      var l = new List<string>(); for (int i = 0; i < n; i++) l.Add(info[i].app);
      return string.Join(", ", l);
    } finally { RmEndSession(h); }
  }
}
"@
[RM]::Who($env:HB_FILE)
