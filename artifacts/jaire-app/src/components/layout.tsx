import { Link, useLocation } from "wouter";
import { useGetWalletBalance, useConnectWallet } from "@workspace/api-client-react";
import { Wallet, Menu, X, Activity, MessageSquare, History, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { formatUSDC } from "@/lib/currency";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: wallet, isLoading: isWalletLoading } = useGetWalletBalance();
  const connectWallet = useConnectWallet();

  const handleConnect = () => {
    connectWallet.mutate({ data: { wallet_type: "web3auth" } });
  };

  const navLinks = [
    { href: "/workspaces", label: "Workspaces", icon: Building2 },
    { href: "/bookings", label: "Bookings", icon: History },
    { href: "/baire", label: "Baire AI", icon: MessageSquare },
    { href: "/analytics", label: "Analytics", icon: Activity },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
                <span className="text-primary-foreground font-bold tracking-tighter">JI</span>
              </div>
              <span className="font-bold text-xl tracking-tight hidden sm:block">JaIre</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = location.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-secondary text-foreground" 
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {wallet?.connected ? (
              <Link href="/wallet">
                <Button variant="outline" className="font-mono gap-2 border-primary/20 hover:bg-primary/10">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="hidden sm:inline">{formatUSDC(wallet.balance_usdc)}</span>
                </Button>
              </Link>
            ) : (
              <Button 
                onClick={handleConnect} 
                disabled={connectWallet.isPending || isWalletLoading}
                className="gap-2 font-mono"
              >
                <Wallet className="w-4 h-4" />
                Connect
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-card p-4 flex flex-col gap-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors",
                    isActive 
                      ? "bg-secondary text-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
