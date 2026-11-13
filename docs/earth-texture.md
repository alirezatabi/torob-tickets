# Earth imagery

The interactive globe uses `public/globe/earth-blue-marble.jpg`, a locally served 2048 × 1024
cloud-free equirectangular Earth image. It provides the satellite-style surface colors, vegetation,
deserts, snow/ice, and relief shading; the globe reprojects it onto a sphere in the browser and
keeps the route/country outlines as sharp SVG overlays.

## Attribution and provenance

The raster is a downsampled derivative of NASA Earth Observatory's **Blue Marble: Next Generation —
July base map**, produced by Reto Stöckli at NASA Goddard Space Flight Center. NASA's source imagery
is public domain. The 2048 × 1024 derivative was obtained from the texture collection in
[MaxwellLee/physics-lab](https://github.com/MaxwellLee/physics-lab), whose `assets/textures/SOURCES.md`
records the source and bicubic downsampling/JPEG processing. The upstream source image is
`world.200407.3x5400x2700.jpg` from the NASA Earth Observatory Blue Marble Next Generation
collection.

This asset is bundled locally: no tile server, runtime hotlink, API key, or third-party map service
is used. It is a Blue Marble satellite-color/relief map, not Google's proprietary Google Earth data.
