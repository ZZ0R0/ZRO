#!/usr/bin/env bash
# dump.sh — concatène le contenu des fichiers de plusieurs extensions sous plusieurs chemins.
# Usage:
#   dump.sh -x EXT [-x EXT...] -p PATH [-p PATH...] [-c] [-w] [-l]
# Env:
#   EXCLUDES=".git node_modules target build dist .venv"
#   MAX_SIZE="10M"            # ignore fichiers > taille
#   ALLOW_BINARY=1            # inclure binaires
#   CASE_INSENSITIVE=1        # -iname au lieu de -name
set -Eeuo pipefail

usage() {
  cat >&2 <<'U'
Usage: dump.sh -x EXT [-x EXT...] [-p PATH...] [-c] [-w] [-l]
  -x EXT   Extension sans le point (répétable)
  -p PATH  Racine à scanner (répétable, défaut: .)
  -c       Copier la sortie finale dans le presse-papiers (Linux: xclip / wl-copy)
  -w       Avec -c, cible le presse-papiers Windows via clip.exe (WSL)
  -l       Afficher le nombre total de lignes des fichiers inclus (à la fin)
U
  exit 1
}

exts=()
paths=()
copy_clip=0
win_clip=0
show_lines=0

while getopts ":x:p:cwlh" opt; do
  case "$opt" in
    x) exts+=( "${OPTARG#.}" ) ;;
    p) paths+=( "$OPTARG" ) ;;
    c) copy_clip=1 ;;
    w) win_clip=1 ;;
    l) show_lines=1 ;;
    h|\?|:) usage ;;
  esac
done
shift $((OPTIND-1))

(( ${#exts[@]} )) || usage
(( ${#paths[@]} )) || paths=( "." )

if [[ -n "${EXCLUDES:-}" ]]; then
  read -r -a EXCL <<< "${EXCLUDES}"
else
  EXCL=(.git node_modules target build dist .venv)
fi

size_arg=()
[[ -n "${MAX_SIZE:-}" ]] && size_arg=( -size "-${MAX_SIZE}" )

name_kw="-name"
[[ -n "${CASE_INSENSITIVE:-}" ]] && name_kw="-iname"

ext_pred=( "(" "${name_kw}" "*.${exts[0]}" )
for e in "${exts[@]:1}"; do
  ext_pred+=( -o "${name_kw}" "*.${e}" )
done
ext_pred+=( ")" )

prune=( -type d "(" -name "${EXCL[0]}" )
for d in "${EXCL[@]:1}"; do
  prune+=( -o -name "$d" )
done
prune+=( ")" -prune )

mapfile -d '' FILES < <(
  find "${paths[@]}" \
    "(" "${prune[@]}" ")" -o \
    "(" -type f "${ext_pred[@]}" "${size_arg[@]}" -print0 ")"
)

(( ${#FILES[@]} )) || { echo "Aucun fichier pour: ${exts[*]} sous: ${paths[*]}" >&2; exit 2; }

tmp="$(mktemp -t dump-ext.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

mapfile -d '' FILES_SORTED < <(printf '%s\0' "${FILES[@]}" | sort -z)

total_lines=0

for f in "${FILES_SORTED[@]}"; do
  if [[ -z "${ALLOW_BINARY:-}" ]] && ! grep -Iq . -- "$f"; then
    printf '[skip binaire] %s\n' "$f" >&2
    continue
  fi

  if (( show_lines )); then
    # Comptage robuste (gère noms avec espaces). Si wc échoue, on ne casse pas tout le dump.
    if lc=$(wc -l < "$f" 2>/dev/null); then
      # Trim whitespace
      lc="${lc#"${lc%%[![:space:]]*}"}"
      lc="${lc%"${lc##*[![:space:]]}"}"
      [[ -n "$lc" ]] && total_lines=$(( total_lines + lc ))
    else
      printf '[warn] impossible de compter les lignes: %s\n' "$f" >&2
    fi
  fi

  {
    printf '%s\n' "$f"
    cat -- "$f"
    printf '\n\n'
  } >>"$tmp"
done

cat -- "$tmp"

if (( show_lines )); then
  printf '\n[total lignes] %d\n' "$total_lines"
fi

copy_to_linux_clip() {
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard < "$tmp" || { echo "Copie presse-papiers (xclip) : échec." >&2; exit 3; }
  elif command -v wl-copy >/dev/null 2>&1; then
    wl-copy < "$tmp" || { echo "Copie presse-papiers (wl-copy) : échec." >&2; exit 3; }
  else
    echo "Aucun utilitaire de presse-papiers Linux trouvé. Installez xclip ou wl-clipboard, ou utilisez -w." >&2
    exit 3
  fi
}

copy_to_windows_clip() {
  # Tente clip.exe direct, sinon PowerShell
  if [[ -x /mnt/c/Windows/System32/clip.exe ]]; then
    /mnt/c/Windows/System32/clip.exe < "$tmp" || { echo "clip.exe a échoué." >&2; exit 3; }
  elif command -v clip.exe >/dev/null 2>&1; then
    clip.exe < "$tmp" || { echo "clip.exe a échoué." >&2; exit 3; }
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; $txt=[Console]::In.ReadToEnd(); Set-Clipboard -Value $txt' < "$tmp" \
      || { echo "Set-Clipboard a échoué." >&2; exit 3; }
  else
    echo "Impossible d'accéder au presse-papiers Windows. Ni clip.exe ni powershell.exe trouvés." >&2
    exit 3
  fi
}

if (( copy_clip )); then
  if (( win_clip )); then
    copy_to_windows_clip
  else
    copy_to_linux_clip
  fi
fi
