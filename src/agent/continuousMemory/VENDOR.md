# pi-observational-memory 3.0.4

Vendored from `npm:pi-observational-memory@3.0.4` (MIT).

Do not edit `vendor/` to add Enso behavior. Wrap in `extension.ts`:
- map Enso `smartCompactModel` onto `runtime.config.model`
- empty/error compact → Enso verified fallback (never `undefined` on overflow)
