# EventPass Barrio

**Estudiante:** Joan Sebastian Chaparro Rodriguez
**Estudiante:** Gabriela Silva
**Proyecto integrador:** desarrollo web + servicios HTTP + IA aplicada + automatización con n8n

**App publicada:** https://eventpass-barrio.vercel.app

> La lógica corre en n8n en mi equipo, publicado con ngrok. Para que la página funcione completa, n8n y ngrok tienen que estar encendidos (ver [Cómo correrlo](#cómo-correrlo)).

---

## ¿Qué es?

EventPass Barrio es mi versión de EventPass: una página para inscribirse a los planes que arma la comunidad del barrio en temporada navideña. Le di una identidad de **Navidad colombiana**: novenas de aguinaldos, noche de velitas, alumbrados, buñuelos y natilla, el torneo de fin de año y el bazar de los emprendedores.

Desde la página se puede:

- ver el catálogo de eventos sin cuenta y filtrarlo por categoría
- registrarse confirmando el correo con un código de 6 dígitos (y recibir un correo de bienvenida)
- iniciar y cerrar sesión
- ver y editar el perfil, cambiar la contraseña o desactivar la cuenta
- vincular Telegram con un código (obligatorio para inscribirse) y decidir si además quiere los avisos por correo
- guardarse el recordatorio de un evento por WhatsApp con un botón
- inscribirse a un evento (si está lleno se entra a lista de espera)
- ver, editar y cancelar las inscripciones
- hablar con un asistente que responde dudas (solo informa, no hace cambios)

Y de forma automática:

- cuando alguien cancela, el cupo pasa al que lleva más tiempo en la lista de espera
- llegan recordatorios 24 horas y 2 horas antes del evento
- todas las notificaciones pasan por un servicio central que intenta **Telegram y Gmail** por separado

Los eventos los administra solo el administrador, con un formulario de n8n.

Además tiene **roles**: VECINO, SUPERVISOR (por ejemplo el representante del barrio, que puede ver quién está inscrito en cada evento) y ADMINISTRADOR (asigna roles y administra los eventos).

---

## Arquitectura

```
 Página en Vercel (React)
        │  fetch (JSON)          widget de chat
        ▼                              ▼
 ┌──────────────────────── n8n ─────────────────────────┐
 │ Webhooks  ·  Form Trigger  ·  Schedule  ·  Telegram   │
 │ Chat Trigger  ·  Execute Sub-workflow                 │
 │                                                      │
 │ validaciones · reglas del negocio · estados ·        │
 │ idempotencia · auditoría                              │
 └───────────┬───────────────────────────┬──────────────┘
             ▼                           ▼
     Google Sheets (EP01…EP10)   Gmail · Telegram · Gemini
```

La regla principal que seguí: **el frontend es solo un cliente**. No tiene ninguna credencial ni toca Google Sheets; todo lo pide a n8n por HTTP, y n8n decide si se puede o no.

---

## Tecnologías

| Parte | Qué usé |
|---|---|
| Frontend | React 19 + Vite, React Router, CSS a mano |
| Chat | `@n8n/chat` (widget oficial de n8n) |
| Hosting del front | Vercel |
| Backend / lógica | n8n 2.41 (local, publicado con ngrok) |
| Persistencia | Google Sheets (10 archivos + `EP11_Checkin` del examen) |
| Notificaciones | Gmail + bot de Telegram |
| IA | Google Gemini (`gemini-flash-latest`, con `gemini-flash-lite-latest` de respaldo) en el nodo AI Agent |

---

## Workflows

Están exportados desde mi instancia de n8n en la carpeta [`n8n/`](n8n/).

| Workflow | Trigger | Google Sheets | Qué hace |
|---|---|---|---|
| WF01_usuarios_crud | Webhook `POST ep/usuarios` | EP01_Usuarios | verificar correo, crear, perfil, actualizar, desactivar |
| WF02_auth_sesiones | Webhook `POST ep/auth` + Execute Sub-workflow Trigger | EP02_Sesiones | login, logout, validar sesión |
| WF03_vinculacion_telegram | Webhook `POST ep/telegram` + Telegram Trigger | EP03_Telegram | código de vinculación y `/vincular` |
| WF04_eventos_crud | n8n Form Trigger | EP04_Eventos | CRUD de eventos (admin) |
| WF05_catalogo_publico | Webhook `GET ep/catalogo` | EP05_Catalogo_Log | listado, detalle, filtro y cupos |
| WF06_inscripciones_crud | Webhook `POST ep/inscripciones` | EP06_Inscripciones | crear, mis, actualizar, cancelar |
| WF07_reasignacion_lista_espera | Schedule (cada 2 min) | EP07_Reasignaciones | promueve la lista de espera |
| WF08_recordatorios | Schedule (cada 15 min) | EP08_Recordatorios | recordatorios 24 h y 2 h |
| WF09_notificaciones | Execute Sub-workflow Trigger | EP09_Notificaciones | envío central Gmail + Telegram |
| WF10_eventpass_assistant | Chat Trigger | EP10_Soporte | asistente con Gemini |
| WF11_checkin_digital _(examen)_ | Webhook `POST ep/checkin` | EP11_Checkin (y actualiza EP06) | check-in digital: valida, guarda el intento, pasa la inscripción a `ASISTIO` y avisa por WF09 |
| WF00_crear_hojas_y_datos_prueba _(adicional)_ | Webhook `GET ep-setup-hojas` | crea EP01…EP10 | setup inicial, se corre una vez |

Cómo se llaman entre ellos:

- WF01, WF03, WF06, WF10 y WF11 llaman a **WF02** como sub-workflow para validar el token.
- WF04, WF06, WF07, WF08 y WF11 llaman a **WF09** para notificar.

El detalle de columnas de cada hoja está en [`docs/google-sheets.md`](docs/google-sheets.md).

---

## Comunicación frontend → n8n

En [`src/api.js`](src/api.js) hay una sola función `llamar()` que usan todas las pantallas:

1. arma la URL con `VITE_N8N_URL` + `/webhook/...`
2. manda JSON (`POST`) o query string (`GET` en el catálogo)
3. agrega el header `ngrok-skip-browser-warning`, porque ngrok gratis mete una página de aviso si no va
4. si la respuesta trae `ok: false` o un status de error, lanza un error con el `mensaje` que mandó n8n, y la pantalla lo muestra

Los webhooks tienen **Allowed Origins (CORS)** habilitado, si no el navegador bloquea las peticiones desde Vercel.

Cada pantalla maneja sus tres estados: **cargando** (spinner), **error** (caja roja con botón de reintentar) y **éxito** (caja verde o el contenido).

## Endpoints

Resumen (con ejemplos completos en [`docs/api.md`](docs/api.md)):

| Método | Ruta | Acciones |
|---|---|---|
| POST | `/webhook/ep/usuarios` | `enviar_codigo`, `crear`, `perfil`, `actualizar`, `desactivar`, `usuarios`*, `asignar_rol`* |
| POST | `/webhook/ep/auth` | `login`, `logout`, `validar` |
| POST | `/webhook/ep/telegram` | `solicitar`, `estado` |
| GET | `/webhook/ep/catalogo` | `tipo=LISTADO \| FILTRO \| DETALLE` |
| POST | `/webhook/ep/inscripciones` | `crear`, `mis`, `actualizar`, `cancelar`, `inscritos`** |
| POST | `/webhook/ep/checkin` | registrar ingreso** (ver [Examen — Registro digital](#examen--registro-digital)) |
| POST | `/webhook/<id>/chat` | chat del asistente (lo usa el widget) |
| – | `/form/ep-admin-eventos` | formulario del administrador (pide correo y contraseña de un ADMINISTRADOR) |

\* solo ADMINISTRADOR · \*\* SUPERVISOR o ADMINISTRADOR

---

## Estados

| Entidad | Estados |
|---|---|
| Usuario | `ACTIVO`, `INACTIVO` |
| Sesión | `ACTIVA`, `CERRADA`, `EXPIRADA` |
| Código de vinculación | `PENDIENTE`, `USADO`, `EXPIRADO`, `CANCELADO` |
| Verificación de correo | `PENDIENTE`, `USADO`, `EXPIRADO`, `CANCELADO` |
| Rol de usuario | `VECINO`, `SUPERVISOR`, `ADMINISTRADOR` |
| Vinculación Telegram | `ACTIVA`, `INACTIVA` |
| Evento | `BORRADOR`, `PUBLICADO`, `CERRADO`, `CANCELADO` |
| Inscripción | `CONFIRMADA`, `LISTA_ESPERA`, `CANCELADA`, `ASISTIO` |
| Check-in (resultado) | `ÉXITOSO`, `RECHAZADO`, `DUPLICADO` |
| Recordatorio | `PENDIENTE`, `ENVIADO`, `ERROR`, `OMITIDO` |
| Canal de notificación | `PENDIENTE`, `ENVIADO`, `ERROR`, `NO_APLICA` |
| Conversación | `ABIERTA`, `CERRADA` |
| Rol de mensaje | `USER`, `ASSISTANT`, `SYSTEM` |

**No se borra nada físicamente.** Desactivar una cuenta la pasa a `INACTIVO`, cancelar un evento lo pasa a `CANCELADO` y cancelar una inscripción la pasa a `CANCELADA`. Todo cambio importante queda además en la hoja de auditoría de su archivo.

---

## Hash de contraseñas

En WF01, el Code node **"Generar hash y salt"** hace esto:

```js
const salt = crypto.randomBytes(16).toString('hex')
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
```

- cada usuario tiene su **propia sal aleatoria**, así dos personas con la misma clave quedan con hashes distintos
- PBKDF2 con 100.000 iteraciones hace que probar claves por fuerza bruta sea lento
- en la hoja solo quedan `password_hash` y `password_salt`; la contraseña nunca se guarda

En el login (WF02, nodo **"Verificar password"**) se recalcula el hash con la sal guardada y se compara con `crypto.timingSafeEqual`. Si el correo no existe o la clave está mal, el mensaje es el mismo ("Correo o contraseña incorrectos"), para no revelar qué correos están registrados.

Para que el Code node pueda usar `require('crypto')`, n8n se arranca con `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (está en `n8n/iniciar-n8n.ps1`).

## Verificación del correo al registrarse

Para que no se creen cuentas con correos inventados, el registro tiene dos pasos:

1. La persona llena sus datos y pide el código (`enviar_codigo`). WF01 revisa que el correo no esté registrado, genera un código de 6 dígitos con `crypto.randomInt` y lo manda por Gmail. En la hoja `Verificaciones_Email` **no queda el código**, solo `sha256(email:codigo)`, igual que con las contraseñas.
2. La persona escribe el código y se llama `crear`. Antes de crear la cuenta se revisa que el código coincida, que no haya vencido (10 minutos) y que no lleve más de 5 intentos fallidos. Si está bien, la verificación pasa a `USADO` y se crea el usuario.

Para evitar abusos solo se puede pedir un código por minuto, y al pedir uno nuevo los anteriores quedan `CANCELADO`.

Apenas se crea la cuenta, WF01 llama a WF09 con el tipo `CUENTA_CREADA` y le llega a la persona un **correo de bienvenida** confirmando el registro. El código de verificación se manda directo desde WF01 porque en ese momento la persona todavía no es un usuario registrado; todo lo que va a usuarios ya registrados pasa por WF09.

## Sesiones

No usé JWT. En el login se genera un token aleatorio (`crypto.randomBytes(24)`, 48 caracteres hex) y se guarda en `EP02_Sesiones` con `expira_en` = ahora + 8 horas.

El front guarda el token en `localStorage` y lo manda en cada operación privada. Cualquier workflow que necesite saber quién es el usuario llama al sub-workflow de validación de WF02, que revisa en este orden:

1. que el token exista → si no, `NO_EXISTE`
2. que no esté `CERRADA` (logout)
3. que no haya pasado `expira_en` → si pasó, la marca `EXPIRADA` en la hoja
4. que el usuario siga `ACTIVO`

Si todo está bien, actualiza `ultima_validacion` y devuelve el usuario. Si no, el workflow que llamó responde `401` y el front cierra la sesión local y manda al login.

## Idempotencia

Que repetir la misma acción no duplique cosas:

- **Inscripciones:** antes de crear se busca si ya existe una inscripción no cancelada con el mismo `usuario_id + evento_id`. Si existe, responde `409 INSCRIPCION_DUPLICADA` y no escribe nada. Además el botón se deshabilita mientras se envía.
- **Registro:** el correo se normaliza (minúsculas, sin espacios) y no se permite repetido.
- **Recordatorios:** cada uno tiene `clave_idempotencia = usuario_id|evento_id|tipo_recordatorio`. Si esa clave ya está en `EP08_Recordatorios`, no se vuelve a mandar aunque el Schedule corra cada 15 minutos.
- **Notificaciones:** WF09 arma una clave con `tipo|usuario|evento|inscripción` y si ya hay una enviada con esa clave no la repite.
- **Códigos de Telegram:** un código `USADO` no sirve otra vez, y al pedir uno nuevo los `PENDIENTE` anteriores pasan a `CANCELADO`.
- **Logout:** cerrar una sesión ya cerrada responde ok igual.
- **Check-in:** una inscripción no puede tener dos check-in `ÉXITOSO`. Si se repite, responde `DUPLICADO` y no cambia nada (detalle en [Examen — Registro digital](#examen--registro-digital)).

## Lista de espera y reasignación

**Cupos disponibles = capacidad − inscripciones CONFIRMADAS o ASISTIO** (quien ya entró al evento sigue ocupando su cupo). No hay ningún campo de "cupos" escrito a mano: siempre se calcula (en WF05, WF06 y WF07).

- Al inscribirse, si hay cupo queda `CONFIRMADA`; si no, queda `LISTA_ESPERA` con su `orden_espera` (informativo).
- Al cancelar una confirmada, el cupo queda libre.
- **WF07** corre cada 2 minutos: para cada evento `PUBLICADO` y futuro calcula cupos libres, toma la lista de espera, la **ordena por `fecha_inscripcion` ascendente** (nodo Sort) y promueve solo a los primeros N.

Ejemplo: 2 cupos libres y 5 en espera → el 1 y el 2 pasan a `CONFIRMADA`; el 3, 4 y 5 siguen esperando.

Cada promoción se guarda en `EP07_Reasignaciones` (con el resultado de la notificación), queda en la auditoría de inscripciones y se notifica por WF09.

## Servicio central de notificaciones (WF09)

Ningún workflow manda correos ni mensajes por su cuenta: todos llaman a WF09 con `usuario_id, tipo, titulo, mensaje, evento_id, inscripcion_id`.

WF09:

1. busca el correo del usuario (EP01) y su `chat_id` (EP03)
2. revisa que no sea un duplicado (clave de idempotencia)
3. manda el **Gmail**. El nodo tiene la salida de error activada: si falla, se anota `ERROR` con el mensaje y **se sigue**
4. manda el **Telegram**, igual con su propia salida de error. Si el usuario no tiene Telegram queda `NO_APLICA`
   - Telegram se intenta siempre. El correo depende de la preferencia `avisos_email` del usuario (viene en `SI`); si la apagó, Gmail queda `NO_APLICA`. El correo de bienvenida siempre sale porque es la confirmación del registro
5. guarda una fila en `EP09_Notificaciones` con `gmail_estado` y `telegram_estado` por separado

Así un fallo de Gmail no esconde lo que pasó con Telegram, ni al revés.

Tipos que se mandan: `CUENTA_CREADA`, `INSCRIPCION_CONFIRMADA`, `INGRESO_LISTA_ESPERA`, `INSCRIPCION_CANCELADA`, `REASIGNACION_CUPO`, `RECORDATORIO_24H`, `RECORDATORIO_2H`, `EVENTO_CANCELADO`, `EVENTO_ACTUALIZADO` (cuando el admin cambia fecha, hora o lugar) y `CHECKIN_REALIZADO` (cuando se registra su ingreso al evento).

## Canales de aviso: Telegram obligatorio, correo opcional y botón de WhatsApp

- **Telegram es obligatorio**, como pide el enunciado: WF06 no deja inscribirse sin Telegram vinculado (`403 TELEGRAM_NO_VINCULADO`) y todos los avisos se intentan por Telegram.
- **El correo es un extra**: en **Mi perfil**, en "¿Por dónde te avisamos?", Telegram aparece marcado y bloqueado, y debajo está la casilla **"También por correo electrónico"** (viene activada). Se guarda en la columna `avisos_email` de la hoja Usuarios; `avisos_telegram` siempre queda en `SI`.
- WF09 sigue intentando **Gmail y Telegram por separado**, cada uno con su registro independiente.
- **WhatsApp:** en el detalle del evento y en "Mis inscripciones" hay un botón **"Recordármelo por WhatsApp"** que abre WhatsApp con el recordatorio ya escrito (evento, fecha, hora, lugar y link) usando `wa.me`. No es un envío automático: para eso se necesita la API de WhatsApp Business de Meta, que pide cuenta de empresa y plantillas aprobadas, y no tenía sentido para un proyecto académico.

## Roles (extra)

| Rol | Puede |
|---|---|
| `VECINO` | todo lo normal: ver eventos, inscribirse, su perfil. Es el rol con el que se crea toda cuenta |
| `SUPERVISOR` | lo del vecino + el **Panel**: ver quién está inscrito en cada evento (confirmados, lista de espera con su puesto, cancelados), contadores de cupos y **descargar la lista en CSV** para Excel. También registra el **check-in** de quien llega al evento. Ve los correos tapados a medias (`ma***@gmail.com`) |
| `ADMINISTRADOR` | lo del supervisor (con correos completos y también los eventos en BORRADOR) + **asignar roles** (Vecino, Supervisor o Administrador) a cualquier usuario, tanto en la pestaña "Usuarios y roles" como directamente en la lista de inscritos de cada evento + usar el **formulario de administración de eventos** |

Cómo está hecho:

- El rol se guarda en la columna `rol` de la hoja Usuarios (vacío = `VECINO`).
- WF02 devuelve el rol en el login y en la validación de sesión, así cada workflow sabe quién está pidiendo qué. **Los permisos se revisan en n8n**, no en la página: aunque alguien llame el webhook a mano, si no tiene el rol recibe `403 SIN_PERMISO`.
- **WF01** tiene dos acciones nuevas solo para administradores: `usuarios` (lista) y `asignar_rol`. Un administrador no puede cambiar su propio rol (así nunca se queda el sistema sin administradores). Cada cambio queda en `Auditoria_Usuarios` (`ASIGNAR_ROL`, con quién lo hizo) y a la persona le llega un aviso por WF09.
- **WF06** tiene la acción `inscritos` para supervisores y administradores (solo lectura).
- **WF04** (formulario de eventos) ahora pide **correo y contraseña de un ADMINISTRADOR** antes de hacer cualquier cosa; antes cualquiera con el link podía usarlo. En la auditoría de eventos queda qué admin hizo el cambio.
- Como en WF01, WF02 y WF04 viajan contraseñas, esos workflows **no guardan las ejecuciones exitosas** (`saveDataSuccessExecution: none`), para que no queden contraseñas en el historial de n8n.
- Los eventos se siguen creando y editando **solo desde el formulario de n8n**, como pide el enunciado; el panel del administrador tiene un botón que lo abre.

## Asistente IA (WF10)

Es el globito de chat abajo a la derecha. Usa el widget `@n8n/chat` contra un **Chat Trigger** público.

Cómo funciona:

1. el `conversation_id` se genera con un hash del `sessionId` del widget (`CNV-XXXX`)
2. si el usuario tiene sesión, el widget manda el token y se valida con WF02; si no, se usa el `visitor_id`
3. se leen los eventos y las inscripciones **en modo solo lectura** y se arma un contexto con datos reales (cupos, fechas, lugares y las inscripciones del usuario si está logueado)
4. el AI Agent con **Gemini** responde usando ese contexto, con memoria de los últimos mensajes de esa conversación. Si el modelo principal está saturado (pasa seguido con la capa gratis), el agente usa un modelo de respaldo más liviano; tiene 3 reintentos y, si aun así falla, responde un mensaje amable en vez de romper el chat
5. se guarda la conversación en `Conversaciones` y **cada mensaje** (`USER`, `ASSISTANT` y uno `SYSTEM` al inicio) en `Mensajes`. Filtrando por `conversation_id` se reconstruye la conversación completa.

**Restricciones:** el asistente no tiene ninguna tool conectada, entonces aunque quisiera no podría escribir nada. Además el prompt le dice que no puede crear usuarios, iniciar sesión, inscribir, cancelar, modificar eventos, cambiar cupos ni estados, que no invente datos y que no pida contraseñas. Si le piden algo de eso, explica cómo hacerlo en la página.

---

## Variables de entorno

Archivo [`.env.example`](.env.example):

| Variable | Para qué |
|---|---|
| `VITE_N8N_URL` | URL base de n8n (sin `/` al final) |
| `VITE_N8N_CHAT_URL` | URL del Chat Trigger de WF10 |
| `VITE_TELEGRAM_BOT` | usuario del bot, sin `@` (para el botón "Abrir bot") |

Ninguna es secreta: son URLs públicas. Los secretos (OAuth de Google, token del bot, API key de Gemini) **solo están dentro de las credenciales de n8n** y no se suben al repo.

---

## Cómo correrlo

### 1. n8n

1. Tener n8n instalado (`npm install -g n8n`) y [ngrok](https://ngrok.com) con su authtoken configurado.
2. Arrancar con el script, que deja la zona horaria de Bogotá, habilita `crypto` y abre ngrok:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\n8n\iniciar-n8n.ps1 -Dominio tu-dominio.ngrok-free.dev
   ```
3. En n8n crear las credenciales: Google Sheets OAuth2, Gmail OAuth2, Telegram API y Google Gemini API.
4. Importar los JSON de `n8n/`, asignarles las credenciales y ejecutar una vez **WF00** para crear las hojas.
5. Poner los IDs de las hojas nuevas en los nodos de Google Sheets y activar WF01 a WF10.

### 2. Frontend

```bash
npm install
cp .env.example .env    # y llenar las URLs
npm run dev
```

### 3. Deploy

En Vercel: importar el repo, framework **Vite**, y agregar las tres variables `VITE_*` en *Settings → Environment Variables*. El `vercel.json` redirige todas las rutas a `index.html` para que funcione React Router al recargar.

### Administrar eventos

Entrar con una cuenta ADMINISTRADOR → **Panel → Administrar eventos** (o abrir `https://<dominio-de-n8n>/form/ep-admin-eventos`), poner el correo y la contraseña de administrador, elegir la acción (CREAR, CONSULTAR, ACTUALIZAR, CANCELAR o CERRAR) y llenar los campos.

---

## Examen — Registro digital

**Estudiante:** Achinti Morales Hernández

Extensión individual de EventPass para controlar el **ingreso real** de los asistentes. Un supervisor (o administrador) registra el check-in de una inscripción; el sistema valida, guarda el intento, pasa la inscripción de `CONFIRMADA` a `ASISTIO` y le avisa a la persona por **Gmail y Telegram**.

No se rehízo nada: es un workflow nuevo (**WF11**), un Google Sheets nuevo (**EP11_Checkin**) y una pantalla nueva, que reutilizan la sesión (WF02), el servicio de notificaciones (WF09) y las hojas que ya existían.

### Qué se agregó

| Archivo | Qué es |
|---|---|
| [`n8n/WF11_checkin_digital.json`](n8n/WF11_checkin_digital.json) | workflow exportado de n8n (Webhook `POST ep/checkin`) |
| `EP11_Checkin` (Google Sheets, hoja `Checkins`) | persistencia de todos los intentos de check-in |
| [`src/pages/CheckIn.jsx`](src/pages/CheckIn.jsx) y `CheckIn.css` | pantalla `/checkin` (solo SUPERVISOR y ADMINISTRADOR) |
| `src/api.js` | función `registrarCheckin` |

Ajustes pequeños en lo que ya existía, para que el estado nuevo no rompa nada (ver [Cupos y `ASISTIO`](#cupos-y-asistio)): WF05, WF06, WF07 y WF10 en n8n, y en el front `App.jsx` (ruta), `Navbar`, `MisInscripciones`, `utils.js` e `index.css`.

### Punto final

```
POST {VITE_N8N_URL}/webhook/ep/checkin
```

Solo lo pueden usar **SUPERVISOR** y **ADMINISTRADOR**. Igual que el resto del proyecto, el permiso se revisa en n8n (WF11 valida el token llamando a WF02), no en la página.

### Estructura de la petición

```json
{
  "token": "<token de la sesión del supervisor>",
  "inscripcion_id": "INS-K3F9A2",
  "evento_id": "EVT-0001"
}
```

`inscripcion_id` y `evento_id` son los dos datos obligatorios del enunciado; `token` es el dato adicional que pide mi implementación. Los ids se normalizan (mayúsculas, sin espacios) y deben tener entre 3 y 40 caracteres entre letras, números, `-` y `_`.

### Estructura de la respuesta

Siempre JSON, con el mismo estilo del resto de la API.

**Éxito** · `200`

```json
{
  "ok": true,
  "resultado": "ÉXITOSO",
  "mensaje": "Check-in realizado correctamente.",
  "checkin_id": "CHK-MH3K2ZAB",
  "inscripcion_id": "INS-K3F9A2",
  "evento_id": "EVT-0001",
  "usuario_id": "USR-XXXX",
  "estado": "ASISTIO",
  "fecha_checkin": "2026-10-29T14:05:12-05:00",
  "nombre_acreditacion": "Ana",
  "evento": { "nombre": "Novena de aguinaldos en el parque", "fecha": "2026-12-16", "hora": "18:30", "lugar": "..." },
  "notificacion": { "gmail": "ENVIADO", "telegram": "ENVIADO" }
}
```

**Duplicado o rechazado** · el `resultado` dice cuál es, y `error` y `mensaje` explican el motivo

```json
{
  "ok": false,
  "resultado": "DUPLICADO",
  "error": "CHECKIN_DUPLICADO",
  "mensaje": "El ingreso ya había sido registrado el 2026-10-29 14:05.",
  "checkin_id": "CHK-MH3K3C1D",
  "inscripcion_id": "INS-K3F9A2",
  "evento_id": "EVT-0001"
}
```

| Caso | HTTP | `resultado` | `error` |
|---|---|---|---|
| Check-in válido | 200 | `ÉXITOSO` | – |
| Ya tenía check-in | 409 | `DUPLICADO` | `CHECKIN_DUPLICADO` |
| La inscripción no existe | 404 | `RECHAZADO` | `INSCRIPCION_NO_EXISTE` |
| El evento no existe | 404 | `RECHAZADO` | `EVENTO_NO_EXISTE` |
| La inscripción es de otro evento | 409 | `RECHAZADO` | `EVENTO_INCORRECTO` |
| Cancelada, en lista de espera u otro estado | 409 | `RECHAZADO` | `ESTADO_NO_PERMITIDO` |
| Datos incompletos o con formato raro | 400 | – | `DATOS_INVALIDOS` |
| Sin sesión válida | 401 | – | `SESION_*` |
| Rol sin permiso | 403 | – | `SIN_PERMISO` |

La pantalla `/checkin` diferencia las tres situaciones con color e ícono: verde (éxito), ámbar (duplicado) y rojo (rechazado). Si es éxito, muestra además si el aviso por Gmail y Telegram salió.

### Validaciones implementadas

WF11 las hace **en este orden**, cada una en su propio nodo IF:

1. los datos de la petición están completos y tienen formato válido
2. la sesión es válida y el rol es SUPERVISOR o ADMINISTRADOR
3. la **inscripción existe**
4. el **evento existe**
5. la inscripción **corresponde a ese evento**
6. **no hay un check-in exitoso previo** (duplicado)
7. la inscripción está en estado **`CONFIRMADA`**

El duplicado se revisa *antes* del estado a propósito: después del primer check-in la inscripción queda en `ASISTIO` (ya no `CONFIRMADA`), y el segundo intento tiene que salir `DUPLICADO` y no `RECHAZADO`.

### Archivo de Google Sheets utilizado

**`EP11_Checkin`**, archivo nuevo e independiente. No se guarda nada del check-in dentro de `EP06_Inscripciones`, salvo el cambio de estado de la inscripción (y su fila de auditoría, como en el resto del proyecto).

### Estructura de `Checkins`

Hoja `Checkins`, una fila por intento:

| Columna | Qué guarda |
|---|---|
| `checkin_id` | id del registro (`CHK-...`), uno por intento |
| `inscripcion_id` | inscripción que se intentó registrar |
| `evento_id` | evento con el que se intentó (el que mandó la petición) |
| `usuario_id` | dueño de la inscripción (vacío si la inscripción no existe) |
| `fecha_checkin` | fecha y hora del intento, ISO con zona de Colombia |
| `resultado` | `ÉXITOSO`, `RECHAZADO` o `DUPLICADO` |
| `detalle` | qué pasó y quién lo registró (ej. `Estado de la inscripción: CANCELADA (operador USR-...)`) |

### Cambio de estado `CONFIRMADA` → `ASISTIO`

Solo ocurre cuando todas las validaciones pasan. El nodo *Actualizar inscripción a ASISTIO* hace un `update` con `inscripcion_id` como columna de coincidencia y **manda únicamente** `estado` y `fecha_actualizacion`, así que no toca ninguna otra columna ni ninguna otra inscripción. El cambio queda además en `Auditoria_Inscripciones` (`accion = ASISTENCIA`).

### Cómo se evita el check-in duplicado

- Antes de registrar, WF11 lee `Checkins` y busca una fila de **esa inscripción con `resultado = ÉXITOSO`**. También considera duplicado si la inscripción ya está en `ASISTIO`.
- Si es duplicado responde `409 DUPLICADO`, guarda el intento como `DUPLICADO` y **no** actualiza la inscripción, **no** audita y **no** vuelve a notificar.
- Un intento `RECHAZADO` o `DUPLICADO` no bloquea un check-in válido posterior, porque solo cuentan las filas `ÉXITOSO`.
- En la pantalla el botón se bloquea mientras se envía, así un doble clic no manda dos peticiones.
- Limitación conocida: Google Sheets no tiene restricciones de unicidad, así que dos peticiones idénticas que llegaran en el mismo instante podrían pasar la lectura a la vez. En producción esto se resuelve con una base de datos y un índice único sobre el check-in exitoso de cada inscripción.

### Integración con WF09 Notificaciones

El check-in exitoso llama a **WF09** como sub-workflow con `tipo = CHECKIN_REALIZADO` (usuario, título, mensaje, evento e inscripción). WF11 **no** tiene lógica propia de Gmail ni de Telegram: WF09 intenta cada canal por separado y deja el resultado en `EP09_Notificaciones`, y WF11 devuelve ese estado en `notificacion`. Si WF09 fallara, el check-in ya quedó guardado, así que se responde éxito con `notificacion: null`.

Para que el usuario reciba **los dos** avisos tiene que tener Telegram vinculado y un correo real con "También por correo electrónico" activado en su perfil (los usuarios `@example.com` de prueba no reciben Gmail, por diseño de WF09).

### Cupos y `ASISTIO`

Los cupos se calculan como `capacidad − inscripciones que ocupan cupo`. Antes solo contaban las `CONFIRMADA`; si no se hubiera tocado, una persona que ya entró habría "liberado" su cupo y WF07 habría subido a alguien de la lista de espera. Por eso `ASISTIO` también ocupa cupo en WF05 (catálogo), WF06 (inscribirse y panel), WF07 (reasignación) y WF10 (asistente). Además WF06 no deja cancelar una inscripción `ASISTIO` (`409 YA_ASISTIO`). WF08 no necesitó cambios: solo recuerda a las `CONFIRMADA`, así que quien ya entró no recibe recordatorios.

### Cómo dejarlo funcionando

1. Crear en Google Sheets un archivo **`EP11_Checkin`** con una hoja **`Checkins`** y esta fila 1 (una celda por columna):
   `checkin_id` · `inscripcion_id` · `evento_id` · `usuario_id` · `fecha_checkin` · `resultado` · `detalle`
2. En n8n: importar `n8n/WF11_checkin_digital.json`, asignar la credencial de Google Sheets en los nodos de hojas y elegir los workflows **WF02** y **WF09** en los nodos *Validar sesión (WF02)* y *Notificar check-in (WF09)*.
3. Abrir el nodo **Configuración** y pegar el ID de `EP11_Checkin` (el texto de la URL entre `/d/` y `/edit`). Si tus hojas EP04 y EP06 tienen otros IDs, se cambian ahí también.
4. Activar WF11 y probar desde `/checkin` (con una cuenta SUPERVISOR o ADMINISTRADOR, por ejemplo `marta.vecina@example.com` / `Vecino2026*`).

### Pruebas

El código de inscripción lo ve cada persona en **Mis inscripciones** (campo "Código de ingreso").

| Caso | Qué hacer | Resultado esperado |
|---|---|---|
| 1 · Check-in válido | inscripción `CONFIRMADA`, evento correcto, sin check-in previo | `ÉXITOSO`, la inscripción pasa a `ASISTIO`, llegan Gmail y Telegram |
| 2 · Duplicado | repetir exactamente lo mismo | `DUPLICADO`, nada cambia y no llega otro aviso |
| 3 · Inscripción no válida | usar una `CANCELADA` o una en `LISTA_ESPERA` | `RECHAZADO` |
| 4 · Evento incorrecto | inscripción de `EVT-0001` enviada con `EVT-0002` | `RECHAZADO` |

Todos los intentos aparecen en `EP11_Checkin / Checkins`.

---

## Datos de prueba

9 eventos navideños en 5 categorías (con cupos, lleno, próximo, cancelado, cerrado y un borrador) y 3 usuarios de prueba. Todo explicado en [`docs/datos-de-prueba.md`](docs/datos-de-prueba.md), junto con la prueba completa de lista de espera.

## Estructura del repo

```
/
├── src/                 código del frontend (React)
│   ├── pages/           pantallas
│   ├── components/      navbar, tarjetas, estados, chat
│   ├── api.js           todas las llamadas a n8n
│   └── auth.jsx         manejo de la sesión en el navegador
├── public/              favicon e ilustraciones de categorías
├── n8n/                 workflows exportados (.json) + script para arrancar n8n
├── docs/                endpoints, estructura de hojas, datos de prueba
├── .env.example
└── README.md
```
