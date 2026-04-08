import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import Workspaces from "@/pages/workspaces";
import WorkspaceDetail from "@/pages/workspace-detail";
import BookWorkspace from "@/pages/book";
import Session from "@/pages/session";
import Bookings from "@/pages/bookings";
import Baire from "@/pages/baire";
import WalletPage from "@/pages/wallet";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/workspaces" component={Workspaces} />
        <Route path="/workspaces/:id" component={WorkspaceDetail} />
        <Route path="/book/:workspaceId" component={BookWorkspace} />
        <Route path="/session/:bookingId" component={Session} />
        <Route path="/bookings" component={Bookings} />
        <Route path="/baire" component={Baire} />
        <Route path="/wallet" component={WalletPage} />
        <Route path="/analytics" component={Analytics} />
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
