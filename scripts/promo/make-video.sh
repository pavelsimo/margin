#!/usr/bin/env bash
# Assembles the promo video from frames captured by record.mjs:
#   .promo/frames + frames.txt + meta.json  ->  .promo/out/margin-promo.mp4 + docs/promo.gif
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROMO="$ROOT/.promo"
OUT="$PROMO/out"
FONT="${PROMO_FONT:-/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Bold.ttf}"
mkdir -p "$OUT"

m() { jq -r ".marksVideo[\"$1\"]" "$PROMO/meta.json"; }
S1=$(m scene1); S2=$(m scene2); S3=$(m scene3); OUTRO=$(m outro)
END=$(jq -r '.videoDuration' "$PROMO/meta.json")

echo "Scene marks (video time): scene1=$S1 scene2=$S2 scene3=$S3 outro=$OUTRO end=$END"

# 1) frames -> 1080p master (real per-frame durations from the concat file)
ffmpeg -y -loglevel error -f concat -safe 0 -i "$PROMO/frames.txt" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,format=yuv420p" \
  -c:v libx264 -preset slow -crf 18 -movflags +faststart "$OUT/master.mp4"

# 2) caption overlays (no colons/commas in text: they break the filtergraph)
DT="fontfile=$FONT:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=h-110"
C1_END=$(jq -r '.marksVideo.scene2 - 0.4' "$PROMO/meta.json")
C2_END=$(jq -r '.marksVideo.scene3 - 0.4' "$PROMO/meta.json")
C3_END=$(jq -r '.marksVideo.outro + 2.2' "$PROMO/meta.json")
ffmpeg -y -loglevel error -i "$OUT/master.mp4" -vf "\
drawtext=$DT:text='Add any arXiv paper':enable='between(t,$S1,$C1_END)',\
drawtext=$DT:text='ELI12 any passage':enable='between(t,$S2,$C2_END)',\
drawtext=$DT:text='Select a formula and just ask':enable='between(t,$S3,$C3_END)'" \
  -c:v libx264 -preset slow -crf 18 -movflags +faststart "$OUT/margin-promo.mp4"

# 3) README gif
mkdir -p "$ROOT/docs"
ffmpeg -y -loglevel error -i "$OUT/margin-promo.mp4" \
  -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 "$ROOT/docs/promo.gif"

echo "MP4: $OUT/margin-promo.mp4 ($(du -h "$OUT/margin-promo.mp4" | cut -f1))"
echo "GIF: $ROOT/docs/promo.gif ($(du -h "$ROOT/docs/promo.gif" | cut -f1))"
