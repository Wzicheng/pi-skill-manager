# Release notes

This package is structured as a pi extension package.

## Included

- `extensions/index.ts`
- `package.json` with `pi.extensions`
- `README.md`
- `LICENSE`

## Recommended verification

```bash
pi install /Users/prince/github/extension/pi-skill-manage
/reload
/skills-zh-status
/skills-zh
/skills-zh refresh git-commit
```

## Publish checklist

- Confirm commands load after `/reload`
- Confirm model-based translation works in a real pi session
- Add screenshot or demo video
- Push to GitHub
- Optionally publish to npm
