# Second Brain demo video

This folder contains a Hyperframes composition and rendered assets for the GitHub README and portfolio website demo video.

## Files

- `index.html` — the renderable Hyperframes composition.
- `STORYBOARD.md` — the planned message, scenes, and research-backed direction.
- `poster.png` — generated from the closing frame for README and website poster usage.
- `renders/second-brain-demo-portfolio-720p.mp4` — lightweight H.264 version for README links and portfolio pages.
- `renders/second-brain-demo-portfolio-720p.webm` — lightweight VP9/WebM version for website fallback/source sets.
- `renders/second-brain-readme-demo.mp4` — full 1920×1080 Hyperframes render.

## Current rendered assets

| Asset | Resolution | FPS | Size | Best use |
| --- | ---: | ---: | ---: | --- |
| `renders/second-brain-demo-portfolio-720p.mp4` | 1280×720 | 24 | ~1.7 MB | README click target, portfolio primary source |
| `renders/second-brain-demo-portfolio-720p.webm` | 1280×720 | 24 | ~1.1 MB | Portfolio fallback/source |
| `renders/second-brain-readme-demo.mp4` | 1920×1080 | 30 | ~11.1 MB | High-quality master |

## Render locally

```bash
cd media/demo/second-brain-readme-demo
npx hyperframes check --snapshots
npx hyperframes render --quality standard --workers 1 --output renders/second-brain-readme-demo.mp4
npx hyperframes snapshot --at 53
```

## GitHub README embed

Use a clickable poster image:

```markdown
[![Watch the Second Brain demo](media/demo/second-brain-readme-demo/poster.png)](media/demo/second-brain-readme-demo/renders/second-brain-demo-portfolio-720p.mp4)
```

If you want GitHub-hosted inline playback, upload the MP4 to a GitHub issue/comment or release asset and replace the local MP4 link with the generated `github.com/user-attachments/assets/...` URL.

## Portfolio website embed

Use the small web assets directly:

```html
<video
  class="second-brain-demo"
  poster="/media/demo/second-brain-readme-demo/poster.png"
  controls
  playsinline
  preload="metadata"
>
  <source src="/media/demo/second-brain-readme-demo/renders/second-brain-demo-portfolio-720p.webm" type="video/webm" />
  <source src="/media/demo/second-brain-readme-demo/renders/second-brain-demo-portfolio-720p.mp4" type="video/mp4" />
  Watch the Second Brain demo video.
</video>
```

Recommended display treatment:

```css
.second-brain-demo {
  width: 100%;
  max-width: 1120px;
  aspect-ratio: 16 / 9;
  border-radius: 24px;
  background: #17120f;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.24);
}
```

The video is intentionally silent and text-led so it works in muted portfolio sections, GitHub previews, and social/product contexts.
