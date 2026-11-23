import { createContext, useContext, useState, useEffect } from 'react';

// Simple authentication context for admin dashboard
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [csrfToken, setCsrfToken] = useState('');
  const [adminInfo, setAdminInfo] = useState(null);

  // On mount, attempt to restore session via /api/admin/me
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const resp = await fetch(`${'http://localhost:5000/api'}/admin/me`, {
          credentials: 'include'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.success) {
            setIsAuthenticated(true);
            setAdminInfo(data.admin);
            setCsrfToken(data.csrfToken || '');
          }
        }
      } catch (e) {
        console.error('Session restore failed', e);
      }
    };
    restoreSession();
  }, []);

  const login = (admin, token) => {
    setIsAuthenticated(true);
    setAdminInfo(admin);
    setCsrfToken(token);
  };

  const logout = async () => {
    try {
      await fetch(`${'http://localhost:5000/api'}/admin/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrfToken }
      });
    } catch (e) {
      console.error('Logout request failed', e);
    } finally {
      setIsAuthenticated(false);
      setAdminInfo(null);
      setCsrfToken('');
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, adminInfo, csrfToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
