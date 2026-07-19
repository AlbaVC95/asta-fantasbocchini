# 🎯 Asta FantaSbocchini

Tool de subasta en vivo para la lega FantaSbocchini.

## Estructura

```
asta-fantasbocchini/
├── backend/
│   └── server.js          ← Servidor Node.js + Socket.io
├── frontend/
│   ├── index.html         ← SPA principal
│   ├── css/style.css      ← Estilos (dark theme, mobile-first)
│   ├── js/app.js          ← Lógica cliente + WebSocket
│   └── assets/            ← Imágenes, sonidos, etc.
├── package.json
└── README.md
```

## Cómo ejecutar

### Tab 1: Instalar y arrancar servidor
```bash
cd C:/Users/acarraga/Projects/asta-fantasbocchini
npm install
npm run dev
```

### Tab 2: Desarrollo
Edita archivos en `frontend/` o `backend/` — el servidor se reinicia solo con `npm run dev`.

### Acceder
Abrir en el navegador: http://localhost:3000

## Tecnologías
- **Backend**: Node.js + Express + Socket.io
- **Frontend**: HTML/CSS/JS vanilla (sin frameworks)
- **Tiempo real**: WebSocket (Socket.io)
- **Deploy**: Render.com / Railway (gratis)

## Flujo
1. Admin crea asta → genera link
2. Participantes entran con el link
3. Se llaman jugadores (libre/random/alfabético)
4. Timer de rilancio → pujas en tiempo real
5. Timer expira → jugador asignado
6. Budget y rose se actualizan para todos

## TODO
- [ ] Base de datos de jugadores Serie A
- [ ] Persistencia (ahora es in-memory)
- [ ] Panel admin (pausar, deshacer, etc.)
- [ ] Funcionalidades extra de Alba
- [ ] Deploy a producción
