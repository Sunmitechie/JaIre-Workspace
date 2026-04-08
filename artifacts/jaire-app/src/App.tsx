import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { isLoggedIn } from "@/lib/auth";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Workspaces from "@/pages/workspaces";
import WorkspaceDetail from "@/pages/workspace-detail";
import BookWorkspace from "@/pages/book";
import Session from "@/pages/session";
import Bookings from "@/pages/bookings";
import Baire from "@/pages/baire";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
// wallet page removed from public routes (web2 UX — no wallet exposed)

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location] = useLocation();
  if (!isLoggedIn()) {
    return <Redirect to="/login" />;
  }
  return <Component />;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/workspaces">{() => <ProtectedRoute component={Workspaces} />}</Route>
        <Route path="/workspaces/:id">{() => <ProtectedRoute component={WorkspaceDetail} />}</Route>
        <Route path="/book/:workspaceId">{() => <ProtectedRoute component={BookWorkspace} />}</Route>
        <Route path="/session/:bookingId">{() => <ProtectedRoute component={Session} />}</Route>
        <Route path="/bookings">{() => <ProtectedRoute component={Bookings} />}</Route>
        <Route path="/baire">{() => <ProtectedRoute component={Baire} />}</Route>
        <Route path="/analytics">{() => <ProtectedRoute component={Analytics} />}</Route>
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
