import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { api, errorText, type ContaDaAxon } from './api';
import './entrada.css';

/**
 * A porta da Axon.
 *
 * No computador local não existe porta: a tela abre direto.
 * No servidor, nada aparece antes de você entrar — nem o nome dos projetos.
 */

interface Entrada {
  conta: ContaDaAxon | null;
  exigeLogin: boolean;
  sair: () => Promise<void>;
}

const EntradaContexto = createContext<Entrada>({ conta: null, exigeLogin: false, sair: async () => {} });
export const useEntrada = () => useContext(EntradaContexto);

type Situacao = 'verificando' | 'entrar' | 'primeira-conta' | 'dentro';

export function PortaDaAxon({ children }: { children: ReactNode }) {
  const [situacao, setSituacao] = useState<Situacao>('verificando');
  const [exigeLogin, setExigeLogin] = useState(false);
  const [conta, setConta] = useState<ContaDaAxon | null>(null);

  const conferir = useCallback(async () => {
    try {
      const status = await api.statusDeEntrada();
      setExigeLogin(status.exigeLogin);
      if (!status.exigeLogin) {
        setSituacao('dentro');
        return;
      }
      if (!status.temConta) {
        setSituacao('primeira-conta');
        return;
      }
      try {
        const eu = await api.quemSouEu();
        setConta(eu.account);
        setSituacao('dentro');
      } catch {
        setSituacao('entrar');
      }
    } catch {
      // Sem resposta do servidor a tela normal mostra o próprio erro.
      setSituacao('dentro');
    }
  }, []);

  useEffect(() => { void conferir(); }, [conferir]);

  // Sessão vencida durante o uso: volta para a porta sem perder o que estava aberto.
  useEffect(() => {
    const aoExpirar = () => { setConta(null); setSituacao('entrar'); };
    window.addEventListener('axon:sessao-expirada', aoExpirar);
    return () => window.removeEventListener('axon:sessao-expirada', aoExpirar);
  }, []);

  const sair = useCallback(async () => {
    try { await api.sair(); } catch { /* a sessão já pode ter vencido */ }
    setConta(null);
    setSituacao('entrar');
  }, []);

  if (situacao === 'verificando') {
    return (
      <div className="porta-carregando" role="status">
        <Loader2 size={18} />
        <span>Abrindo a Axon…</span>
      </div>
    );
  }

  if (situacao === 'entrar' || situacao === 'primeira-conta') {
    return (
      <TelaDeEntrada
        primeiraConta={situacao === 'primeira-conta'}
        aoEntrar={contaQueEntrou => { setConta(contaQueEntrou); setSituacao('dentro'); }}
      />
    );
  }

  return <EntradaContexto.Provider value={{ conta, exigeLogin, sair }}>{children}</EntradaContexto.Provider>;
}

function TelaDeEntrada({ primeiraConta, aoEntrar }: { primeiraConta: boolean; aoEntrar: (conta: ContaDaAxon) => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErro('');
    if (primeiraConta && senha !== confirmacao) {
      setErro('As duas senhas precisam ser iguais.');
      return;
    }
    if (primeiraConta && senha.length < 12) {
      setErro('A senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    setEnviando(true);
    try {
      if (primeiraConta) await api.criarPrimeiraConta({ username: usuario, displayName: nome || usuario, password: senha });
      const { account } = await api.entrar(usuario, senha);
      aoEntrar(account);
    } catch (e) {
      setErro(errorText(e));
      setEnviando(false);
    }
  }

  return (
    <main className="porta">
      <div className="porta-cartao">
        <div className="porta-marca">
          AXON<span className="porta-marca-ponto">.</span>
        </div>
        <h1>{primeiraConta ? 'Crie sua conta' : 'Entrar'}</h1>
        <p className="porta-legenda">
          {primeiraConta
            ? 'Esta é a primeira conta e vira a dona desta Axon. Depois dela, o cadastro fecha.'
            : 'Seus projetos, checkpoints e recados ficam atrás desta porta.'}
        </p>

        <form className="form-stack porta-form" onSubmit={enviar}>
          {primeiraConta && (
            <label>
              Seu nome
              <input value={nome} onChange={e => setNome(e.target.value)} maxLength={80} autoComplete="name" placeholder="Como você quer ser chamado" />
            </label>
          )}
          <label>
            Usuário
            <input
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              maxLength={80}
              autoComplete="username"
              autoFocus
              required
              placeholder="Ex.: ana"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              autoComplete={primeiraConta ? 'new-password' : 'current-password'}
              required
              placeholder={primeiraConta ? 'Pelo menos 12 caracteres' : ''}
            />
          </label>
          {primeiraConta && (
            <label>
              Repita a senha
              <input type="password" value={confirmacao} onChange={e => setConfirmacao(e.target.value)} autoComplete="new-password" required />
            </label>
          )}

          {erro && <p className="porta-erro" role="alert">{erro}</p>}

          <button type="submit" className="button primary porta-botao" disabled={enviando}>
            {enviando ? <Loader2 size={15} className="porta-girando" /> : <ArrowRight size={15} />}
            {enviando ? (primeiraConta ? 'Criando…' : 'Entrando…') : primeiraConta ? 'Criar conta e entrar' : 'Entrar'}
          </button>
        </form>

        <p className="porta-rodape">
          <ShieldCheck size={13} />
          A sessão dura 12 horas neste aparelho.
        </p>
      </div>
    </main>
  );
}
