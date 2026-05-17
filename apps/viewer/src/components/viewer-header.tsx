import { Workflow } from 'lucide-react';
import { Link, useMatch } from 'react-router-dom';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 20px',
  height: 52,
  background: '#fff',
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
  zIndex: 20,
};

const logoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 700,
  fontSize: 16,
  color: '#0f172a',
  textDecoration: 'none',
  letterSpacing: '-0.02em',
};

const studioLinkStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#64748b',
  textDecoration: 'none',
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  transition: 'color 0.15s, background 0.15s',
};

export function ViewerHeader() {
  const isFlowView = useMatch('/flow/:uuid');
  return (
    <header style={headerStyle}>
      <Link to="/" style={logoStyle}>
        <Workflow size={20} color="#34d399" strokeWidth={2} />
        SeeFlow
      </Link>
      {!isFlowView && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link to="/flows" style={studioLinkStyle}>
            Flows
          </Link>
          <Link to="/" style={studioLinkStyle}>
            SeeFlow Studio
          </Link>
        </div>
      )}
    </header>
  );
}
