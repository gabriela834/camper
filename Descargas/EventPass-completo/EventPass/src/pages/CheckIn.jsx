import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { formatearFecha, getVisitorId } from '../utils'
import './CheckIn.css'

const ROLES_CHECKIN = ['SUPERVISOR', 'ADMINISTRADOR']

// los 3 resultados del backend (ÉXITOSO, DUPLICADO, RECHAZADO) + el "error" de red/servidor
const VARIANTES = {
  exito: { titulo: 'Ingreso registrado', tag: 'ÉXITOSO', clase: 'ok' },
  duplicado: { titulo: 'Este ingreso ya estaba registrado', tag: 'DUPLICADO', clase: 'pocos' },
  rechazado: { titulo: 'Ingreso rechazado', tag: 'RECHAZADO', clase: 'espera' },
  error: { titulo: 'No se pudo registrar', tag: 'ERROR', clase: 'off' },
}

const AVISO = {
  ENVIADO: { texto: 'Enviado', clase: 'ok' },
  ERROR: { texto: 'Falló', clase: 'espera' },
  NO_APLICA: { texto: 'No aplica', clase: 'off' },
  PENDIENTE: { texto: 'Pendiente', clase: 'pocos' },
}

const cuando = (iso) => String(iso || '').slice(0, 16).replace('T', ' ')
const horaLocal = () => new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

function IconoResultado({ tipo }) {
  const trazos = {
    exito: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    duplicado: (
      <>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a3 3 0 013-3h15" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v2a3 3 0 01-3 3H3" />
      </>
    ),
    rechazado: <path d="M6 6l12 12M18 6L6 18" />,
    error: (
      <>
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4M12 17.5v.5" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {trazos[tipo]}
    </svg>
  )
}

function Avisos({ notificacion }) {
  if (!notificacion) {
    return <p className="mini ci-avisos-nota">El ingreso quedó guardado, pero no pudimos confirmar el aviso a la persona.</p>
  }
  const canales = [
    ['Gmail', notificacion.gmail],
    ['Telegram', notificacion.telegram],
  ]
  return (
    <div className="ci-avisos">
      <span className="mini">Aviso a la persona:</span>
      {canales.map(([nombre, estado]) => {
        const a = AVISO[estado] || { texto: estado || '—', clase: 'off' }
        return (
          <span key={nombre} className={`tag tag-${a.clase}`}>
            {nombre}: {a.texto}
          </span>
        )
      })}
    </div>
  )
}

function Resultado({ r }) {
  const v = VARIANTES[r.tipo]
  const d = r.datos || {}
  return (
    <article className={`ci-card ci-card--${r.tipo}`} role={r.tipo === 'exito' ? 'status' : 'alert'}>
      <div className="ci-icono">
        <IconoResultado tipo={r.tipo} />
      </div>
      <div className="ci-cuerpo">
        <span className={`tag tag-${v.clase}`}>{v.tag}</span>
        <h2>{v.titulo}</h2>
        <p className="ci-mensaje">{r.mensaje}</p>
        <dl className="ci-datos">
          {d.nombre_acreditacion && (
            <>
              <dt>Asistente</dt>
              <dd>{d.nombre_acreditacion}</dd>
            </>
          )}
          {d.evento?.nombre && (
            <>
              <dt>Evento</dt>
              <dd>
                {d.evento.nombre}
                <span className="mini"> · {formatearFecha(d.evento.fecha, d.evento.hora)}</span>
              </dd>
            </>
          )}
          <dt>Inscripción</dt>
          <dd>
            <code>{d.inscripcion_id || r.inscripcion}</code>
          </dd>
          {d.fecha_checkin && (
            <>
              <dt>Hora de ingreso</dt>
              <dd>{cuando(d.fecha_checkin)}</dd>
            </>
          )}
          {d.checkin_id && (
            <>
              <dt>Registro</dt>
              <dd>
                <code>{d.checkin_id}</code>
              </dd>
            </>
          )}
        </dl>
        {r.tipo === 'exito' && <Avisos notificacion={d.notificacion} />}
      </div>
    </article>
  )
}

export default function CheckIn() {
  const { token, usuario, sesionVencida } = useAuth()
  const navigate = useNavigate()
  const permitido = ROLES_CHECKIN.includes(usuario?.rol)

  const [eventos, setEventos] = useState([])
  const [evento, setEvento] = useState('')
  const [inscripcion, setInscripcion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [historial, setHistorial] = useState([])
  const bloqueo = useRef(false) // un envío a la vez aunque den doble clic o Enter dos veces
  const campoInscripcion = useRef(null)

  // el catálogo solo sirve para sugerir eventos; si falla el campo igual se puede escribir a mano
  useEffect(() => {
    if (!permitido) return
    api
      .listarEventos(getVisitorId())
      .then((r) => setEventos(r.eventos || []))
      .catch(() => {})
  }, [permitido])

  if (!permitido) return <Navigate to="/" replace />

  const eventoId = evento.trim().toUpperCase()
  const inscripcionId = inscripcion.trim().toUpperCase()
  const eventoElegido = eventos.find((e) => e.evento_id === eventoId)

  const enviar = async (ev) => {
    ev.preventDefault()
    if (bloqueo.current || !eventoId || !inscripcionId) return
    bloqueo.current = true
    setEnviando(true)
    setResultado(null)

    let nuevo
    try {
      const r = await api.registrarCheckin(token, inscripcionId, eventoId)
      nuevo = { tipo: 'exito', mensaje: r.mensaje, datos: r, inscripcion: inscripcionId }
      setInscripcion('') // listo para la siguiente persona
    } catch (e) {
      if (e.status === 401) {
        sesionVencida()
        navigate('/login')
        return
      }
      const d = e.data || {}
      const tipo = d.resultado === 'DUPLICADO' ? 'duplicado' : d.resultado === 'RECHAZADO' ? 'rechazado' : 'error'
      nuevo = { tipo, mensaje: e.message, datos: d, inscripcion: inscripcionId }
    } finally {
      bloqueo.current = false
      setEnviando(false)
    }

    setResultado(nuevo)
    setHistorial((h) =>
      [{ id: `${Date.now()}`, hora: horaLocal(), inscripcion: inscripcionId, evento: eventoId, tipo: nuevo.tipo, mensaje: nuevo.mensaje }, ...h].slice(0, 8),
    )
    campoInscripcion.current?.focus()
    if (nuevo.tipo !== 'exito') campoInscripcion.current?.select()
  }

  return (
    <div className="seccion">
      <div className="seccion-titulo">
        <div>
          <h1>Check-in</h1>
          <p className="sub">Registra el ingreso de cada persona cuando llega al evento.</p>
        </div>
        <span className="tag tag-ok">{usuario.rol}</span>
      </div>

      <div className="ci-grid">
        <section className="caja">
          <form className="form" onSubmit={enviar}>
            <label>
              Evento
              <input
                list="ci-eventos"
                value={evento}
                onChange={(e) => setEvento(e.target.value)}
                placeholder="EVT-0001"
                autoComplete="off"
                maxLength={40}
                required
              />
              <datalist id="ci-eventos">
                {eventos.map((e) => (
                  <option key={e.evento_id} value={e.evento_id}>
                    {e.nombre}
                  </option>
                ))}
              </datalist>
              <small>
                {eventoElegido
                  ? `${eventoElegido.nombre} · ${formatearFecha(eventoElegido.fecha, eventoElegido.hora)}`
                  : 'Elige uno de la lista o escribe el ID del evento.'}
              </small>
            </label>

            <label>
              Código de inscripción
              <input
                ref={campoInscripcion}
                className="ci-codigo"
                value={inscripcion}
                onChange={(e) => setInscripcion(e.target.value)}
                placeholder="INS-XXXXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                required
              />
              <small>La persona lo ve en “Mis inscripciones”.</small>
            </label>

            <button className="btn ci-btn" disabled={enviando || !eventoId || !inscripcionId}>
              {enviando ? 'Registrando...' : 'Registrar ingreso'}
            </button>
          </form>
        </section>

        <section className="ci-resultado" aria-live="polite">
          {enviando && (
            <div className="ci-vacio" role="status">
              <span className="spinner" aria-hidden="true" />
              <p>Validando y avisando a la persona...</p>
            </div>
          )}
          {!enviando && resultado && <Resultado r={resultado} />}
          {!enviando && !resultado && (
            <div className="ci-vacio">
              <p>
                <strong>Aquí verás el resultado.</strong>
              </p>
              <p className="mini">Solo entra quien tiene la inscripción CONFIRMADA y es de este evento. Cada ingreso se puede registrar una sola vez.</p>
            </div>
          )}
        </section>
      </div>

      {historial.length > 0 && (
        <section className="caja ci-historial">
          <h2>Últimos intentos de esta sesión</h2>
          <ul>
            {historial.map((h) => (
              <li key={h.id}>
                <span className="mini">{h.hora}</span>
                <code>{h.inscripcion}</code>
                <span className="mini">{h.evento}</span>
                <span className={`tag tag-${VARIANTES[h.tipo].clase}`}>{VARIANTES[h.tipo].tag}</span>
                <span className="mini ci-hist-msg">{h.mensaje}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
