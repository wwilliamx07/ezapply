import { run, which } from "./proc.js";

type PickKind = "folder" | "tex";

type PickResult = { path: string } | { cancelled: true } | { unavailable: true };

/** What the dialog's program prints when the user picks nothing. */
const CANCELLED = "\u0018";

/**
 * The OS's own folder or file dialog, for a path the onboarding page needs (a template's folder). The browser's
 * file picker can't do this: it hands over a file's contents, never its path, and `template_import` must record
 * the path to watch the user's later edits. No shell runs any of it: PowerShell and AppleScript read the title
 * from the environment, never from their script, and the Linux programs take it as an argument. A system with
 * no dialog program says so, and the page asks for the path typed instead.
 */
export async function pickPath(kind: PickKind, title: string): Promise<PickResult> {
  const env = { ...process.env, EZAPPLY_DIALOG_TITLE: title };
  const command = dialogCommand(kind, title);
  if (!command) return { unavailable: true };
  const [program, ...args] = command as [string, ...string[]];
  const result = await run(program, args, { env, timeoutMs: 15 * 60_000 }).catch(() => null);
  if (!result || result.timedOut) return { unavailable: true };
  const out = result.stdout.trim();
  if (!out || out === CANCELLED || result.exitCode !== 0) return { cancelled: true };
  return { path: out };
}

/** The program and arguments for the dialog, or null when the system has none (exported for tests). */
function dialogCommand(kind: PickKind, title: string): string[] | null {
  if (process.platform === "win32") {
    // WinForms dialogs need a single-threaded apartment (-STA); an owner form kept on top brings the dialog in
    // front of the browser that asked for it.
    const dialog =
      kind === "folder"
        ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = $env:EZAPPLY_DIALOG_TITLE; $ok = $d.ShowDialog($f); $p = $d.SelectedPath"
        : "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = $env:EZAPPLY_DIALOG_TITLE; $d.Filter = 'LaTeX (*.tex)|*.tex'; $ok = $d.ShowDialog($f); $p = $d.FileName";
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
      dialog,
      `if ($ok -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($p) } else { [Console]::Out.Write([char]0x18) }`,
    ].join("; ");
    return ["powershell.exe", "-NoProfile", "-STA", "-NonInteractive", "-Command", script];
  }
  if (process.platform === "darwin") {
    const choose =
      kind === "folder"
        ? 'POSIX path of (choose folder with prompt (system attribute "EZAPPLY_DIALOG_TITLE"))'
        : 'POSIX path of (choose file with prompt (system attribute "EZAPPLY_DIALOG_TITLE") of type {"tex", "org.tug.tex"})';
    return ["osascript", "-e", choose];
  }
  if (which("zenity")) {
    return kind === "folder"
      ? ["zenity", "--file-selection", "--directory", `--title=${title}`]
      : ["zenity", "--file-selection", "--file-filter=LaTeX | *.tex", `--title=${title}`];
  }
  if (which("kdialog")) {
    return kind === "folder"
      ? ["kdialog", "--title", title, "--getexistingdirectory", "."]
      : ["kdialog", "--title", title, "--getopenfilename", ".", "*.tex"];
  }
  return null;
}
