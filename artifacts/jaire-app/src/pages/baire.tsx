import { useState, useRef, useEffect } from "react";
import { useBaireChat } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "baire";
  content: string;
};

export default function Baire() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "baire", content: "Hi, I'm Baire. Your workspace concierge. Looking for a hot desk for the afternoon or a private suite for your team?" }
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatMutation = useBaireChat();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatMutation.isPending]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    chatMutation.mutate(
      { data: { message: userMessage } },
      {
        onSuccess: (data) => {
          setMessages(prev => [...prev, { role: "baire", content: data.reply }]);
        },
        onError: () => {
          setMessages(prev => [...prev, { role: "baire", content: "Sorry, I had a network glitch. Could you repeat that?" }]);
        }
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col max-h-[calc(100vh-4rem)] bg-background">
      <div className="border-b border-border/50 bg-card/50 p-4 flex items-center justify-center gap-3 backdrop-blur-sm">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-none">Baire AI</h1>
          <p className="text-xs text-muted-foreground">Always online</p>
        </div>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, i) => (
            <div 
              key={i} 
              className={cn(
                "flex gap-4 max-w-[85%]",
                msg.role === "user" ? "ml-auto flex-row-reverse" : ""
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                msg.role === "baire" ? "bg-primary/20 text-primary" : "bg-secondary text-foreground"
              )}>
                {msg.role === "baire" ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div className={cn(
                "p-4 rounded-2xl text-[15px] leading-relaxed",
                msg.role === "user" 
                  ? "bg-secondary text-foreground rounded-tr-sm" 
                  : "bg-primary/10 text-foreground border border-primary/10 rounded-tl-sm"
              )}>
                {msg.content}
              </div>
            </div>
          ))}
          
          {chatMutation.isPending && (
            <div className="flex gap-4 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 rounded-tl-sm flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-background border-t border-border">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto relative flex items-center">
          <Input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Baire to book a space..." 
            className="pr-12 h-14 rounded-2xl bg-card border-border/50 focus-visible:ring-primary/50 text-base"
            disabled={chatMutation.isPending}
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-2 text-primary hover:text-primary hover:bg-primary/10 rounded-xl"
            disabled={!input.trim() || chatMutation.isPending}
          >
            <Send className="w-5 h-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
