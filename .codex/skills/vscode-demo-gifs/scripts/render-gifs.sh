#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <frame-directory> <output-directory>" >&2
  exit 64
fi
if [[ -z ${MDEPUB_DEMO_ROOT:-} ]]; then
  echo 'MDEPUB_DEMO_ROOT must identify the temporary recording directory.' >&2
  exit 64
fi

scratch_root=$(realpath -m "$MDEPUB_DEMO_ROOT")
frame_root=$(realpath -m "$1")
output_root=$2
temporary_root=$(realpath -m /tmp)
case "$scratch_root/" in
  "$temporary_root/"*) ;;
  *)
    echo 'MDEPUB_DEMO_ROOT must be a dedicated directory below /tmp.' >&2
    exit 64
    ;;
esac
case "$frame_root/" in
  "$scratch_root/"*) ;;
  *)
    echo 'Frame input must remain inside MDEPUB_DEMO_ROOT.' >&2
    exit 64
    ;;
esac
mkdir -p "$output_root"

overwrite_flag=(-n)
if [[ ${MDEPUB_REPLACE_DEMOS:-} == 1 ]]; then
  overwrite_flag=(-y)
fi

render_gif() {
  local output=$1
  local count=$2
  shift 2
  local labels=
  local index
  for ((index = 0; index < count; index++)); do
    labels+="[$index:v]"
  done

  ffmpeg "${overwrite_flag[@]}" -hide_banner -loglevel error "$@" \
    -filter_complex "${labels}concat=n=${count}:v=1:a=0,scale=1080:-2:flags=lanczos,fps=10,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    -loop 0 "$output"
}

render_gif "$output_root/live-preview.gif" 2 \
  -loop 1 -t 0.7 -i "$frame_root/preview-open.png" \
  -loop 1 -t 1.5 -i "$frame_root/live-after-real-edit.png"
render_gif "$output_root/device-preview.gif" 3 \
  -loop 1 -t 0.65 -i "$frame_root/preview-open.png" \
  -loop 1 -t 0.65 -i "$frame_root/device-ipad.png" \
  -loop 1 -t 1.1 -i "$frame_root/device-ipad-landscape.png"
render_gif "$output_root/appearance.gif" 4 \
  -loop 1 -t 0.55 -i "$frame_root/preview-open.png" \
  -loop 1 -t 0.65 -i "$frame_root/appearance-open.png" \
  -loop 1 -t 0.7 -i "$frame_root/appearance-sepia.png" \
  -loop 1 -t 1.0 -i "$frame_root/appearance-final.png"
render_gif "$output_root/search-bookmarks.gif" 4 \
  -loop 1 -t 0.5 -i "$frame_root/search-open.png" \
  -loop 1 -t 0.75 -i "$frame_root/search-results.png" \
  -loop 1 -t 0.65 -i "$frame_root/search-jump.png" \
  -loop 1 -t 1.0 -i "$frame_root/bookmarks-open.png"
render_gif "$output_root/notes.gif" 3 \
  -loop 1 -t 0.55 -i "$frame_root/preview-open.png" \
  -loop 1 -t 0.75 -i "$frame_root/notes-open.png" \
  -loop 1 -t 1.2 -i "$frame_root/notes-jump.png"
render_gif "$output_root/notes-json.gif" 2 \
  -loop 1 -t 0.8 -i "$frame_root/notes-to-json-notes.png" \
  -loop 1 -t 1.6 -i "$frame_root/notes-to-json-json.png"
