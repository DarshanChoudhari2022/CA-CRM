# PSB brand theme

The application uses the PSB website palette, with DM Sans for body and navigation,
Manrope for headings, and Libre Baskerville for the firm name. Source fonts were
copied from `psbassociates/website/dist/assets/fonts` with their three OFL licences
unchanged. `src/app/fonts.css` preserves the supplied font-face definitions, formatted
for this repository; all font requests are local and use `font-display: swap`.
Only the body font is preloaded. The supplied Baskerville asset is normal style;
italic heading emphasis uses browser-synthesized italics, not a separate italic file.

Shared colour and type tokens live in `src/app/globals.css`. The final application
brand layer is `src/app/brand-theme.css`; overview-specific styling remains in
`src/app/(portal)/crm/overview.css`. No runtime theme library or external font service
is required. Error, success, warning and pending-approval indicators retain their
semantic colours rather than being recoloured as decorative gold.

Full desktop branding uses 25.6px Libre Baskerville; the compact sidebar uses 15.68px
to fit its existing width. Page titles follow the supplied responsive clamp, while
form headings stay at 28.8px. Inputs use 15px on desktop and 16px on phones to avoid
mobile input zoom. Buttons and inputs have 4px corners; cards and forms have 8px
corners. Compact mobile tool cards hide secondary descriptions, not action labels.

The original invoice PDF artwork and document typography are deliberately unchanged.
Their two approved reference designs are independent of the web UI theme.
