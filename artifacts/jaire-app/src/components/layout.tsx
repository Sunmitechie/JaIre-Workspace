import { Link, useLocation } from "wouter";
import { Building2, History, MessageSquare, Activity, LogOut, Menu, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getUser, clearUser } from "@/lib/auth";
import { useLocation as useWouterLocation } from "wouter";
import { WalletPanel } from "@/components/wallet-panel";
import { formatNGN } from "@/lib/currency";
import { logoutWeb3Auth } from "@/lib/web3auth";

const NGN_PER_USDC = 1600;

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [, setLocation] = useWouterLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const user = getUser();

  useEffect(() => {
    if (!user?.walletAddress) return;
    let mounted = true;
    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/jaire/devnet/balance/${user.walletAddress}`);
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setUsdcBalance(data.usdc_balance ?? 0);
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, [user?.walletAddress]);

  const handleSignOut = async () => {
    clearUser();
    setLocation("/");
    // Fire-and-forget: logout from Web3Auth session (non-blocking)
    logoutWeb3Auth().catch(() => {});
  };

  const navLinks = [
    { href: "/workspaces", label: "Spaces", icon: Building2 },
    { href: "/bookings", label: "Bookings", icon: History },
    { href: "/baire", label: "Baire AI", icon: MessageSquare },
    { href: "/analytics", label: "Analytics", icon: Activity },
  ];

  const isPublicPage = location === "/" || location === "/login";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-40 w-full border-b border-white/6 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href={user ? "/baire" : "/"} className="flex items-center gap-2.5 group">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all group-hover:scale-105"
                style={{
                  background: "linear-gradient(135deg, rgba(255,170,0,0.25) 0%, rgba(255,170,0,0.1) 100%)",
                  border: "1px solid rgba(255,170,0,0.4)",
                }}
              >
                <span className="text-xs font-bold text-gradient-gold leading-none">JI</span>
              </div>
              <span className="font-bold text-xl tracking-tight hidden sm:block">JaIre</span>
            </Link>

            {user && (
              <nav className="hidden md:flex items-center gap-0.5">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = location.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "text-primary bg-primary/10 border border-primary/20"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                {user.walletAddress && (
                  <button
                    onClick={() => setWalletOpen(true)}
                    className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all hover:scale-[1.02]"
                    style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)" }}
                  >
                    <Wallet className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm font-medium text-primary">
                      {usdcBalance !== null
                        ? formatNGN(usdcBalance * NGN_PER_USDC)
                        : "···"}
                    </span>
                  </button>
                )}

                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/4 border border-white/8">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-primary">{user.name[0]}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground/80">{user.name.split(" ")[0]}</span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="hidden sm:flex gap-1.5 text-muted-foreground hover:text-foreground text-xs"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden w-8 h-8"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                  {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </Button>
              </>
            ) : (
              !isPublicPage && (
                <Link href="/login">
                  <Button
                    size="sm"
                    className="gap-2 font-semibold"
                    style={{
                      background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(43 100% 42%) 100%)",
                      color: "hsl(220 40% 5%)",
                    }}
                  >
                    Sign In
                  </Button>
                </Link>
              )
            )}
          </div>
        </div>

        {isMobileMenuOpen && user && (
          <div className="md:hidden border-t border-white/6 bg-card/95 backdrop-blur-xl p-4 flex flex-col gap-1">
            {user.walletAddress && (
              <button
                onClick={() => { setWalletOpen(true); setIsMobileMenuOpen(false); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium mb-1"
                style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)" }}
              >
                <Wallet className="w-4 h-4 text-primary" />
                <span className="text-primary font-semibold">
                  {usdcBalance !== null ? formatNGN(usdcBalance * NGN_PER_USDC) : "Wallet"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">Top Up</span>
              </button>
            )}
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive
                      ? "text-primary bg-primary/10 border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-2 pt-2 border-t border-white/6">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 w-full"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col relative">
        {children}
      </main>

      {walletOpen && <WalletPanel onClose={() => setWalletOpen(false)} />}
    </div>
  );
}
