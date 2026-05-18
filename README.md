# unimaurox-vuelos-internacionales

Dashboard de vuelos internacionales en tiempo real — datos en vivo de **OpenSky Network**, auto-refresh cada 30s, deploy estático en GitHub Pages.

> Familia [`unimaurox-*`](https://github.com/unimauro?tab=repositories&q=unimaurox): finanzas → colegios → separaciones → seguridad → vuelos.

## Demo

Live: https://unimauro.github.io/unimaurox-vuelos-internacionales/

## Qué muestra

- **6 KPIs**: vuelos activos, países distintos, altitud y velocidad promedio, vuelo más alto y más rápido (callsign + país).
- **Mapa mundial** con marcadores clusterizados (Leaflet + markercluster). Cada avión rota según su rumbo (`true_track`). Color por banda de altitud: verde <3 km, cyan 3–9 km, ámbar >9 km.
- **Top 10 países** por número de vuelos activos.
- **Distribución de altitudes** (bajo / medio / alto).
- **Tabla** de los 20 vuelos más rápidos con callsign, país, altitud, velocidad y rumbo.

## Stack

- HTML + CSS + JavaScript vanilla. **Sin build, sin npm.**
- [Leaflet 1.9.4](https://leafletjs.com/) + [markercluster 1.5.3](https://github.com/Leaflet/Leaflet.markercluster) (CDN unpkg)
- [Chart.js 4](https://www.chartjs.org/) (CDN jsdelivr)
- Tiles: CARTO dark
- Fuente: [OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html)

## Estructura

```
.
├── index.html        # layout
├── css/style.css     # tema ATC dark
├── js/app.js         # fetch + Leaflet + Chart.js + render
├── data/             # vacío (sin assets locales — todo live)
├── .nojekyll         # GH Pages: no procesar con Jekyll
└── README.md
```

## Cómo correr en local

Abrir `index.html` directo en el navegador no funciona en todos los browsers por las llamadas a fetch — mejor servirlo:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Deploy en GitHub Pages

1. Crear repo en GitHub:
   ```bash
   gh repo create unimaurox-vuelos-internacionales --public --source=. --remote=origin --push
   ```
2. En GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`**
3. Esperar ~1 min. Live en `https://<usuario>.github.io/unimaurox-vuelos-internacionales/`.

## Notas sobre OpenSky

- Endpoint público sin auth: rate-limit ~10s entre requests, ventana de créditos diarios limitada. Por eso el dashboard refresca cada **30s** (no más rápido).
- Devuelve ~10–15k vuelos activos globalmente. Por eso se usa **markercluster** — renderizar todos los markers sin agrupar mata al navegador.
- CORS habilitado desde browser, no se necesita proxy.
- Si quieres más frecuencia, regístrate gratis en https://opensky-network.org/ y reemplaza la URL en `js/app.js` por `https://<user>:<pass>@opensky-network.org/api/states/all`. **No commitees credenciales.**

## Estado de conexión

El dot del header tiene 4 estados:

- 🟢 **live** — último fetch OK.
- 🟡 **stale** — falló pero hay datos previos en memoria; se muestran con timestamp.
- 🔴 **error** — sin datos.
- 🔵 **loading** — request en curso.

## Roadmap

- [ ] Filtro por continente / bbox
- [ ] Trail histórico de los últimos N puntos por aeronave
- [ ] Toggle día/noche en tiles
- [ ] Card en `unimauro/unimauro` profile README
- [ ] Snapshot de "vuelos sobre Perú" como vista por defecto opcional

## Licencia

MIT. Datos de OpenSky bajo sus propios términos.
