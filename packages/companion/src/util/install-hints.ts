type InstallableTool = "tex" | "git" | "ghostscript";

/** The command (or instruction) that installs a tool on `platform` (this OS by default), for people: `ezapply doctor` prints it. */
export function installCommand(tool: InstallableTool, platform: NodeJS.Platform = process.platform): string {
  const winget = (id: string) => `winget install --id ${id} -e --accept-source-agreements --accept-package-agreements`;
  const win = platform === "win32";
  const mac = platform === "darwin";
  switch (tool) {
    case "tex":
      return win
        ? winget("MiKTeX.MiKTeX")
        : mac
          ? "brew install --cask mactex-no-gui"
          : "sudo apt install texlive-xetex latexmk";
    case "git":
      return win ? winget("Git.Git") : mac ? "xcode-select --install" : "sudo apt install git";
    case "ghostscript":
      return win
        ? winget("ArtifexSoftware.GhostScript")
        : mac
          ? "brew install ghostscript"
          : "sudo apt install ghostscript";
  }
}

/**
 * How to install a missing dependency, written for Claude: ask the user first, run it, retry the tool.
 * ezapply picks up newly installed tools on its own (see which()), so no restart is needed.
 */
export function installHint(tool: InstallableTool): string {
  const retry = " Then retry; ezapply finds it without a restart.";
  const cmd = installCommand(tool);
  if (process.platform === "linux") {
    // Package managers differ between distributions: the command is an example, and needs sudo.
    const what = { tex: "TeX Live with XeLaTeX", git: "git", ghostscript: "Ghostscript" }[tool];
    return `Ask the user to install ${what} (e.g. \`${cmd}\`).${retry}`;
  }
  if (tool === "tex" && process.platform === "win32") {
    return (
      `Ask the user, then install MiKTeX: \`${cmd}\`. Then let it fetch LaTeX packages without prompting: ` +
      '`& "$env:LOCALAPPDATA\\Programs\\MiKTeX\\miktex\\bin\\x64\\initexmf.exe" --set-config-value=[MPM]AutoInstall=1`.' +
      retry
    );
  }
  return `Ask the user, then run \`${cmd}\`.${retry}`;
}
