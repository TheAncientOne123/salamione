import { Component } from 'react';

/**
 * Si una vista falla al dibujarse, muestra un aviso con opciones para recuperarse
 * en lugar de dejar la página en blanco.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[SalamiOne] Error de interfaz:', error, info?.componentStack);
  }

  reset = () => {
    try {
      // Preferencias locales que podrían estar desactualizadas (vista guardada).
      localStorage.removeItem('s1-view');
    } catch {}
    location.href = '/app#chat';
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <img src="/logo.svg" alt="" width="56" height="56" />
          <h1>Algo no se pudo mostrar</h1>
          <p>La interfaz encontró un error inesperado. Tus evaluaciones y fuentes están guardadas en el servidor y no se perdió nada.</p>
          <pre>{String(this.state.error?.message || this.state.error).slice(0, 300)}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={this.reset}>
              Volver a cargar
            </button>
            <a className="btn" href="/">
              Ir al inicio
            </a>
          </div>
        </div>
      </div>
    );
  }
}
