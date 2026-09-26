/**
 * How to install a missing dependency, written for Claude: ask the user first, run it, retry the tool.
 * The daemon picks up newly installed tools on its own (see which()), so no restart is needed.
 */
export function installHint(tool: "tex" | "git"): string {
  const retry = " Then retry; the daemon finds it without a restart.";
  if (tool === "tex") {
    if (process.platform === "win32") {
      return (
        "Ask the user, then install MiKTeX: `winget install --id MiKTeX.MiKTeX -e --accept-source-agreements " +
        "--accept-package-agreements`. Then let it fetch LaTeX packages without prompting: " +
        '`& "$env:LOCALAPPDATA\\Programs\\MiKTeX\\miktex\\bin\\x64\\initexmf.exe" --set-config-value=[MPM]AutoInstall=1`.' +
        retry
      );
    }
    if (process.platform === "darwin") return `Ask the user, then run \`brew install --cask mactex-no-gui\`.${retry}`;
    return `Ask the user to install TeX Live with XeLaTeX (e.g. \`sudo apt install texlive-xetex latexmk\`).${retry}`;
  }
  if (process.platform === "win32") {
    return `Ask the user, then run \`winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements\`.${retry}`;
  }
  if (process.platform === "darwin") return `Ask the user, then run \`xcode-select --install\`.${retry}`;
  return `Ask the user to install git (e.g. \`sudo apt install git\`).${retry}`;
}
