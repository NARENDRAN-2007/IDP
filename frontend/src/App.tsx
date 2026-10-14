import React from 'react';
import { Route, Switch, Redirect } from 'wouter';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { SocketProvider } from './contexts/SocketContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { HospitalDashboardPage } from './pages/HospitalDashboardPage.js';

function ProtectedHospitalRoute() {
  const { isAuthenticated, isLoading, hospitalId } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Authenticating ER Desk Session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <HospitalDashboardPage />;
}

function HospitalIndexRedirect() {
  const { isAuthenticated, isLoading, hospitalId } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Loading ER Desk...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Redirect to={`/hospital/${hospitalId || 'H001'}`} />;
}

export function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/hospital/:hospitalId" component={ProtectedHospitalRoute} />
          <Route path="/hospital" component={HospitalIndexRedirect} />
          <Route path="/" component={HospitalIndexRedirect} />
          <Route>
            <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
              404 | Station Not Found
            </div>
          </Route>
        </Switch>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
