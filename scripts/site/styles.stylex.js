import * as stylex from '@stylexjs/stylex';

// The static site uses the same compiled atomic styling model as host apps.
// Keep semantic class names in the template for accessibility/browser tooling.
export const colors = stylex.defineVars({
  background: '#102020', ink: '#f3f1e8', muted: '#b6c5bd', accent: '#c7f58a',
  border: '#3a4b43', panel: '#182b2a', command: '#091716',
});

export const styles = stylex.create({
  reset: { boxSizing: 'border-box', '::before': { boxSizing: 'border-box' }, '::after': { boxSizing: 'border-box' } },
  html: { colorScheme: 'dark' },
  body: { margin: 0, backgroundColor: colors.background, color: colors.ink, fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: 16, lineHeight: 1.65 },
  a: { color: { default: colors.accent, ':hover': 'white' }, textUnderlineOffset: '.25em', ':focus-visible': { outline: `3px solid ${colors.accent}`, outlineOffset: 5 } },
  wrap: { maxWidth: 1080, margin: 'auto', paddingBlock: 0, paddingInline: { default: 28, '@media (max-width:720px)': 22 } },
  skip: { position: 'absolute', top: { default: -100, ':focus': 12 }, padding: 12, backgroundColor: colors.background },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: { default: 'center', '@media (max-width:720px)': 'flex-start' }, gap: { default: 20, '@media (max-width:720px)': 10 }, paddingBlock: 22, flexDirection: { default: 'row', '@media (max-width:720px)': 'column' } },
  headerBorder: { borderBottom: `1px solid ${colors.border}` },
  brand: { color: colors.ink, fontWeight: 700, textDecoration: 'none', letterSpacing: '-.025em' },
  brandMark: { color: colors.accent, marginRight: '.5em' },
  nav: { display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: '.9rem' },
  navLink: { color: colors.muted },
  main: { paddingTop: { default: 44, '@media (max-width:720px)': 24 }, paddingBottom: 40 },
  eyebrow: { color: colors.accent, fontSize: '.75rem', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 650 },
  h1: { fontSize: 'clamp(2rem,5vw,3.4rem)', letterSpacing: '-.055em', lineHeight: 1.1, margin: '12px 0 24px' },
  headline: { fontSize: 'clamp(1.6rem,3.5vw,2.5rem)', letterSpacing: '-.035em', lineHeight: 1.2, margin: '0 0 20px', maxWidth: 650 },
  intro: { maxWidth: 660, color: colors.muted, marginBottom: 24 },
  columns: { display: 'grid', gridTemplateColumns: { default: '1fr 1.15fr', '@media (max-width:720px)': 'minmax(0,1fr)' }, gap: { default: 48, '@media (max-width:720px)': 28 }, alignItems: 'start' },
  section: { minWidth: 0 },
  h2: { fontSize: '1.1rem', margin: '0 0 16px' },
  ul: { listStyle: 'none', margin: 0, padding: 0 },
  li: { borderTop: `1px solid ${colors.border}`, paddingBlock: 14, paddingInline: 0 },
  strong: { display: 'block', fontWeight: 650 },
  checkDescription: { color: colors.muted, fontSize: '.9rem' },
  install: { border: `1px solid ${colors.border}`, borderRadius: 7, padding: { default: 24, '@media (max-width:720px)': 20 }, backgroundColor: colors.panel, order: { default: 0, '@media (max-width:720px)': -1 } },
  installParagraph: { margin: '0 0 16px', fontSize: '.9rem' },
  primary: { display: 'inline-block', marginBottom: 20, padding: '10px 18px', backgroundColor: { default: colors.accent, ':hover': 'white' }, color: { default: colors.background, ':hover': colors.background }, borderRadius: 4, fontWeight: 650, textDecoration: 'none' },
  copy: { padding: '7px 12px', marginBottom: 10, backgroundColor: 'transparent', color: colors.accent, border: `1px solid ${colors.border}`, borderRadius: 4, font: 'inherit', fontSize: '.9rem', cursor: 'pointer' },
  button: { ':focus-visible': { outline: `3px solid ${colors.accent}`, outlineOffset: 5 } },
  pre: { padding: 16, margin: '0 0 18px', backgroundColor: colors.command, borderRadius: 4, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '.85rem', lineHeight: 1.8 },
  code: { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace' },
  note: { color: colors.muted, fontSize: '.82rem' },
  experiment: { borderTop: `1px solid ${colors.border}`, marginTop: 34, paddingTop: 18 },
  footer: { borderTop: `1px solid ${colors.border}`, padding: '22px 0' },
  footerLinks: { display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: '.85rem' },
});
