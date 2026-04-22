import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { isLoggedIn } from "@/lib/auth";
import { isOrgLoggedIn } from "@/lib/org-auth";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Scan from "@/pages/scan";
import Workspaces from "@/pages/workspaces";
import WorkspaceDetail from "@/pages/workspace-detail";
import BookWorkspace from "@/pages/book";
import Session from "@/pages/session";
import Bookings from "@/pages/bookings";
import Baire from "@/pages/baire";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import OrgSignup from "@/pages/org-signup";
import OrgKyc from "@/pages/org-kyc";
import OrgDashboard from "@/pages/org-dashboard";
import AdminDashboard from "@/pages/admin";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location] = useLocation();
  if (!isLoggedIn()) {
    return <Redirect to="/login" />;
  }
  return <Component />;
}

function OrgProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  if (!isOrgLoggedIn()) {
    return <Redirect to="/org/signup" />;
  }
  return <Component />;
}

function Router() {
  const [location] = useLocation();
  const isOrgRoute = location.startsWith("/org/");

  return isOrgRoute ? (
    <Switch>
      <Route path="/org/signup" component={OrgSignup} />
      <Route path="/org/kyc">{() => <OrgProtectedRoute component={OrgKyc} />}</Route>
      <Route path="/org/dashboard">{() => <OrgProtectedRoute component={OrgDashboard} />}</Route>
      <Route component={NotFound} />
    </Switch>
  ) : (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
        <Route path="/scan">{() => <ProtectedRoute component={Scan} />}</Route>
        <Route path="/workspaces">{() => <ProtectedRoute component={Workspaces} />}</Route>
        <Route path="/workspaces/:id">{() => <ProtectedRoute component={WorkspaceDetail} />}</Route>
        <Route path="/book/:workspaceId">{() => <ProtectedRoute component={BookWorkspace} />}</Route>
        <Route path="/session/:bookingId">{() => <ProtectedRoute component={Session} />}</Route>
        <Route path="/bookings">{() => <ProtectedRoute component={Bookings} />}</Route>
        <Route path="/baire">{() => <ProtectedRoute component={Baire} />}</Route>
        <Route path="/analytics">{() => <ProtectedRoute component={Analytics} />}</Route>
        <Route path="/admin" component={AdminDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
