# glassyui (vendored-own-the-source, reimplemented)

These components are inspired by alexburlis/glassyui (MIT) and were
reimplemented for this repo from the design contract — they are NOT
copied registry code. No glassyui source file was pasted here.

What was changed vs the upstream registry concept, and why:

- Native material only: glass = a tinted surface with an optional
  `expo-blur` layer. The web SVG lens / refraction displacement from
  glassyui's web docs does not transfer to React Native and was not ported.
- Android rule kept: a `GlassSurface` only blurs inside a `GlassBackdrop`.
  A surface rendered without its backdrop on Android renders as its
  opaque tile fallback, not as broken blur.
- Reduced transparency / increased contrast / low-end tier collapse
  every glass surface to its opaque `tile` fallback by design.
- Glass lives only on the floating layer (tab bar, composer, sheet,
  dialog, menu, toast). Never in scrolling content, never per bubble.

See THIRD_PARTY_NOTICES.md for the MIT attribution.
