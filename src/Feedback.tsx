import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
type Notice = { id: number; message: string; detail?: string };
const FeedbackContext = createContext<(message: string, detail?: string) => void>(()=>{});
export function useFeedback(){return useContext(FeedbackContext);}
export function FeedbackProvider({children}:{children:ReactNode}){
  const [notice,setNotice]=useState<Notice|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const sequence=useRef(0);
  const notify=useCallback((message:string,detail?:string)=>{
    if(timer.current)clearTimeout(timer.current);
    setNotice({id:++sequence.current,message,detail});
    timer.current=setTimeout(()=>setNotice(null),3800);
  },[]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  return <FeedbackContext.Provider value={notify}>{children}<div className="feedback-region" aria-live="polite" aria-atomic="true">{notice&&<div className="feedback-toast" key={notice.id}><span className="feedback-icon"><Check size={16}/></span><div><strong>{notice.message}</strong>{notice.detail&&<p>{notice.detail}</p>}</div><button onClick={()=>setNotice(null)} aria-label="Fechar confirmação"><X size={14}/></button></div>}</div></FeedbackContext.Provider>;
}
