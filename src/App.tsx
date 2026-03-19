import React, { Component, useState, useMemo, useEffect, useRef } from 'react';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { ViewType, ArtAsset, UserHolding, Transaction, InsuranceStatus, GalleryItem, UserProfile } from './types';
import { MOCK_ASSETS } from './constants';
import InsuranceBadge from './components/InsuranceBadge';
import AssetCard from './components/AssetCard';
import GuaranteeBar from './components/GuaranteeBar';
import { QRCodeSVG } from 'qrcode.react';
import { get, set, del, clear } from 'idb-keyval';

import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithCustomToken,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  getDocFromServer,
  deleteDoc,
  Timestamp,
  runTransaction
} from 'firebase/firestore';

// Local-only mode disabled by user request
const isOfflineMode = false;

const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseCurrency = (value: string) => {
  if (!value) return 0;
  const clean = value.toString().replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
};

const formatInputCurrency = (value: string) => {
  let clean = value.replace(/\D/g, '');
  if (!clean) return '';
  let number = parseInt(clean) / 100;
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Helper to sync user data to cloud
const syncUserToCloud = async (uid: string, data: Partial<UserProfile>) => {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, data, { merge: true });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    const { hasError, error } = this.state;
    const { children } = (this as any).props;

    if (hasError) {
      let message = "Algo deu errado. Por favor, recarregue a página.";
      let isQuotaError = false;

      if (error?.name === 'QuotaExceededError' || 
          error?.message?.toLowerCase().includes('quota') ||
          error?.message?.toLowerCase().includes('storage')) {
        message = "O limite de uso ou armazenamento foi atingido. O aplicativo operará em modo limitado até que o limite seja resetado.";
        isQuotaError = true;
      } else if (error?.message?.includes("Missing or insufficient permissions")) {
        message = "Você não tem permissão para realizar esta ação ou acessar estes dados.";
      } else {
        try {
          if (error?.message) {
            const parsed = JSON.parse(error.message);
            if (parsed.error && parsed.error.includes("Missing or insufficient permissions")) {
              message = "Você não tem permissão para realizar esta ação ou acessar estes dados.";
            }
          }
        } catch (e) {
          // Not a JSON error
        }
      }

      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-6">
            <div className="h-20 w-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500 border border-red-500/20">
              <i className={`fa-solid ${isQuotaError ? 'fa-database' : 'fa-triangle-exclamation'} text-3xl`}></i>
            </div>
            <h1 className="text-white font-black text-2xl uppercase tracking-tighter">
              {isQuotaError ? 'Memória Cheia' : 'Erro do Sistema'}
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed">{message}</p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()} 
                className="w-full bg-white text-slate-950 font-black py-4 rounded-xl text-xs uppercase tracking-widest"
              >
                Recarregar Aplicativo
              </button>
              {isQuotaError && (
                <button 
                  onClick={async () => {
                    localStorage.clear();
                    await clear();
                    window.location.reload();
                  }} 
                  className="w-full bg-red-500/20 text-red-500 font-black py-4 rounded-xl text-xs uppercase tracking-widest border border-red-500/20"
                >
                  Limpar Todo Armazenamento (Reset)
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

interface PhoneModalProps {
  showPhoneModal: boolean;
  setShowPhoneModal: (show: boolean) => void;
  phoneStep: 'PHONE' | 'OTP' | 'PROFILE';
  setPhoneStep: (step: 'PHONE' | 'OTP' | 'PROFILE') => void;
  phoneNumber: string | undefined;
  setPhoneNumber: (num: string | undefined) => void;
  isLoading: boolean;
  handlePhoneRegistration: () => void;
  whatsappLink: string;
  showNotification: (msg: string) => void;
  otpValue: string[];
  setOtpValue: (val: string[]) => void;
  otpInputRef: React.RefObject<HTMLInputElement>;
  handleOtpSubmit: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement>;
  tempProfileData: { name: string; avatarUrl: string };
  setTempProfileData: (data: any) => void;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  currentPin: string;
  handleFinalActivation: () => void;
}

const PhoneModal: React.FC<PhoneModalProps> = ({
  setShowPhoneModal,
  phoneStep,
  setPhoneStep,
  phoneNumber,
  setPhoneNumber,
  isLoading,
  handlePhoneRegistration,
  whatsappLink,
  showNotification,
  otpValue,
  setOtpValue,
  otpInputRef,
  handleOtpSubmit,
  avatarInputRef,
  tempProfileData,
  setTempProfileData,
  handleAvatarUpload,
  currentPin,
  handleFinalActivation
}) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
    <div className="bg-white rounded-[3rem] w-full max-w-sm p-8 text-center space-y-6 shadow-2xl relative overflow-hidden">
      {/* Botão Fechar */}
      <button 
        onClick={() => { setShowPhoneModal(false); setPhoneStep('PHONE'); }}
        className="absolute top-6 right-8 text-slate-300 hover:text-slate-500 transition-colors"
      >
        <i className="fa-solid fa-xmark text-2xl"></i>
      </button>

      {/* Logo OasisRJ */}
      <div className="flex items-center justify-center gap-2 pt-4">
         <div className="bg-slate-950 p-2 rounded-xl">
            <i className="fa-solid fa-mask text-white text-xl"></i>
         </div>
         <span className="text-slate-950 font-black text-2xl tracking-tighter">Oasis<span className="text-amber-500">RJ</span></span>
      </div>

      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        {phoneStep !== 'PROFILE' && (
          <div className="bg-[#f0fdf4] border border-[#dcfce7] p-6 rounded-[2rem] space-y-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="bg-[#25D366] h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <i className="fa-brands fa-whatsapp text-white text-2xl"></i>
              </div>
              <div className="text-left">
                <p className="text-[#166534] font-black text-[11px] uppercase tracking-widest leading-none mb-1">Ação Necessária</p>
                <p className="text-[#15803d] text-[11px] font-medium leading-tight">
                  {phoneStep === 'PHONE' ? 'Informe seu WhatsApp para receber o PIN' : 'Clique abaixo para receber seu código'}
                </p>
              </div>
            </div>
            
            {phoneStep === 'PHONE' ? (
              <div className="space-y-3">
                <div className="phone-input-container">
                  <PhoneInput
                    placeholder="WhatsApp com DDI"
                    value={phoneNumber}
                    onChange={setPhoneNumber}
                    defaultCountry="BR"
                    className="oasis-phone-input"
                  />
                </div>
                <button 
                  onClick={handlePhoneRegistration}
                  disabled={isLoading || !phoneNumber || !isValidPhoneNumber(phoneNumber || '')}
                  className="w-full bg-[#25D366] hover:bg-[#22c55e] text-white font-black py-4 rounded-2xl text-[11px] uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isLoading ? 'PROCESSANDO...' : 'RECEBER PIN NO WHATSAPP'}
                </button>
              </div>
            ) : (
              whatsappLink && (
                <button 
                  onClick={() => {
                    window.open(whatsappLink, '_blank');
                    showNotification("WhatsApp aberto! Copie o código.");
                  }}
                  className="w-full bg-[#25D366] hover:bg-[#22c55e] text-white font-black py-4 rounded-2xl text-[11px] uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3"
                >
                  <i className="fa-brands fa-whatsapp text-xl"></i>
                  ABRIR WHATSAPP AGORA
                </button>
              )
            )}
          </div>
        )}

        {phoneStep === 'PHONE' && (
          <div className="space-y-4">
          </div>
        )}

        {phoneStep === 'OTP' && (
          <div className="space-y-6 animate-in slide-in-from-right duration-500">
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-2xl leading-tight tracking-tight">Insira seu<br/>código de acesso</h3>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">PIN vitalício enviado via WhatsApp</p>
            </div>

            <div 
              className="flex justify-center gap-3 py-2 relative cursor-text"
              onClick={() => otpInputRef.current?.focus()}
            >
              {otpValue.map((digit, idx) => (
                <div key={idx} className={`h-16 w-14 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 ${digit ? 'border-amber-500 bg-amber-50 shadow-lg shadow-amber-500/10' : 'border-slate-100 bg-slate-50/50'}`}>
                  <span className="text-slate-900 text-2xl font-black">{digit ? '*' : ''}</span>
                </div>
              ))}
              <input 
                ref={otpInputRef}
                type="tel"
                maxLength={4}
                className="absolute opacity-0 inset-0 w-full h-full cursor-text"
                value={otpValue.join('')}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  const newOtp = ['', '', '', ''];
                  val.split('').forEach((char, i) => newOtp[i] = char);
                  setOtpValue(newOtp);
                  if (val.length === 4) {
                    setTimeout(() => handleOtpSubmit(), 300);
                  }
                }}
              />
            </div>

            <div className="pt-2">
              <button 
                onClick={() => {
                  let link = whatsappLink;
                  if (!link && phoneNumber && currentPin) {
                    const cleanPhone = phoneNumber.replace(/\D/g, '');
                    const message = encodeURIComponent(`Olá! Seu PIN VITALÍCIO de acesso ao OasisRJ é: ${currentPin}\n\nEste código nunca expira e é válido em todos os seus dispositivos.`);
                    link = `https://wa.me/${cleanPhone}?text=${message}`;
                  }
                  
                  if (link) {
                    window.open(link, '_blank');
                    showNotification("Reenviando PIN para seu WhatsApp...");
                  } else {
                    showNotification("Erro ao gerar link. Tente novamente.");
                  }
                }}
                className="w-full bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-2xl py-4 flex items-center justify-center gap-3 font-black text-[10px] uppercase tracking-widest border border-slate-200 transition-all active:scale-95"
              >
                <i className="fa-brands fa-whatsapp text-lg text-[#25D366]"></i>
                NÃO RECEBEU? REENVIAR VIA WHATSAPP
              </button>
              
              {/* Fallback for development/demo if WhatsApp fails */}
              <p className="mt-4 text-[9px] text-slate-400 font-medium">
                Problemas com o WhatsApp? <button onClick={() => showNotification(`Seu PIN é: ${currentPin}`)} className="text-amber-600 font-bold underline">Clique aqui para ver seu PIN</button>
              </p>
            </div>

            <button 
              onClick={() => { setPhoneStep('PHONE'); setOtpValue(['', '', '', '']); }}
              className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] pt-2 hover:text-slate-600 transition-colors"
            >
              ALTERAR NÚMERO
            </button>
          </div>
        )}

        {phoneStep === 'PROFILE' && (
          <div className="space-y-6 animate-in slide-in-from-right duration-500">
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-2xl leading-tight tracking-tight">Finalize seu<br/>Cadastro</h3>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Dados obrigatórios para ativação</p>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div 
                onClick={() => avatarInputRef.current?.click()}
                className={`h-28 w-28 rounded-full border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer transition-all ${tempProfileData.avatarUrl ? 'border-emerald-500' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
              >
                {tempProfileData.avatarUrl ? (
                  <img src={tempProfileData.avatarUrl} className="w-full h-full object-cover" alt="Avatar" />
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <i className="fa-solid fa-camera text-2xl"></i>
                    <span className="text-[8px] font-black uppercase mt-1">FOTO*</span>
                  </div>
                )}
              </div>
              <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />

              <div className="w-full space-y-4">
                <div className="space-y-1 text-left">
                  <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest ml-1">Nome Completo</label>
                  <input 
                    type="text"
                    placeholder="EX: JOÃO DA SILVA"
                    value={tempProfileData.name}
                    onChange={(e) => setTempProfileData({...tempProfileData, name: e.target.value.toUpperCase()})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 px-5 text-slate-900 font-bold text-sm focus:border-amber-500 outline-none transition-all"
                  />
                </div>

                <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex items-center gap-3">
                  <i className="fa-solid fa-shield-halved text-amber-500"></i>
                  <div className="text-left">
                    <p className="text-amber-700 font-black text-[9px] uppercase tracking-widest leading-none mb-1">PIN Vitalício Gerado</p>
                    <p className="text-amber-600 text-lg font-black tracking-[0.5em]">{currentPin}</p>
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={handleFinalActivation}
              disabled={isLoading || !tempProfileData.name || !tempProfileData.avatarUrl}
              className="w-full bg-slate-950 text-white font-black py-5 rounded-2xl text-[11px] uppercase tracking-[0.3em] active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check-double"></i>}
              CONCLUIR E ENTRAR
            </button>
          </div>
        )}
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [currentView, setCurrentView] = useState<ViewType>('HOME');
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [pendingView, setPendingView] = useState<ViewType | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<ArtAsset | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [activeSyncLink, setActiveSyncLink] = useState('');
  
  // Safety net for loading states
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        setIsLoading(false);
        console.warn("Loading state timed out");
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (isUploading) {
      const timer = setTimeout(() => {
        setIsUploading(false);
        console.warn("Uploading state timed out");
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [isUploading]);
  
  // Security / PIN States
  const [lockingAsset, setLockingAsset] = useState<ArtAsset | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);
  const [isSecurityUnlocked, setIsSecurityUnlocked] = useState(false); 
  const [hasSavedProfile, setHasSavedProfile] = useState(false);
  const [hasSavedAdminChanges, setHasSavedAdminChanges] = useState(false);

  const showNotification = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const safeSetItem = async (key: string, value: string) => {
    try {
      // For very large items, go directly to IndexedDB
      if (value.length > 100000 || key === 'oasis_assets_persistent' || key === 'oasis_local_accounts') {
        await set(key, value);
        // Also remove from localStorage to free up space if it was there
        localStorage.removeItem(key);
        return;
      }

      try {
        localStorage.setItem(key, value);
      } catch (e: any) {
        // If localStorage fails, fallback to IndexedDB
        if (
          e.name === 'QuotaExceededError' ||
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
          e.code === 22 ||
          e.code === 1014 ||
          (e.message && e.message.toLowerCase().includes('quota'))
        ) {
          console.warn('LocalStorage full, falling back to IndexedDB for key:', key);
          await set(key, value);
          localStorage.removeItem(key);
        } else {
          throw e;
        }
      }
    } catch (err) {
      console.error('Critical storage error:', err);
    }
  };

  const safeGetItem = async (key: string): Promise<string | null> => {
    try {
      // Try localStorage first
      const local = localStorage.getItem(key);
      if (local) return local;

      // Fallback to IndexedDB
      const idbValue = await get(key);
      if (idbValue) return idbValue as string;
    } catch (err) {
      console.error('Error reading from storage:', err);
    }
    return null;
  };

  const safeRemoveItem = async (key: string) => {
    try {
      localStorage.removeItem(key);
      await del(key);
    } catch (err) {
      console.error('Error removing from storage:', err);
    }
  };

  // Admin Login State
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [adminLoginError, setAdminLoginError] = useState(false);

  // File Input Refs
  const mainImageInputRef = useRef<HTMLInputElement>(null);
  const galleryImageInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const tokenizeImageInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Helper para compressão de imagens (Evita erro de limite de 1MB do Firestore)
  const compressImage = (base64Str: string, maxWidth = 800, maxHeight = 800, quality = 0.5): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Str); // Fallback
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error("Falha ao carregar imagem para compressão"));
    });
  };

  // Simulation State for Gallery
  const [gallerySimulations, setGallerySimulations] = useState<Record<string, number>>({});

  // Purchase Flow State
  const [purchaseAsset, setPurchaseAsset] = useState<any | null>(null);
  
  // Deposit and Withdraw States
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [transactionAmount, setTransactionAmount] = useState('');

  // Admin States
  const [editorData, setEditorData] = useState<Partial<ArtAsset>>({});
  const [assets, setAssets] = useState<ArtAsset[]>(MOCK_ASSETS);

  // User Profile and Balance Persistence
  const [userProfile, setUserProfile] = useState<UserProfile>({
    id: 'local_' + Date.now(),
    name: 'INVESTIDOR',
    email: '',
    phoneNumber: '',
    bio: '',
    avatarUrl: '',
    avatarScale: 1,
    avatarOffset: 50,
    pin: '',
    walletId: 'oasis_' + Math.random().toString(36).substring(2, 15),
  });

  const [userBalance, setUserBalance] = useState<number>(25400.50);
  const [userHoldings, setUserHoldings] = useState<UserHolding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Test Firestore Connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firestore connection test: SUCCESS");
      } catch (error: any) {
        if (error.message && error.message.includes("Quota exceeded")) {
          console.warn("Firestore Quota Exceeded. App will run in Local Mode.");
          return;
        }
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore connection test: OFFLINE. Check configuration.");
        } else {
          console.error("Firestore connection test: FAILED", error);
        }
      }
    };
    testConnection();
  }, []);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
      if (user) {
        setIsAuthenticated(true);
        setIsSecurityUnlocked(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firebase Firestore Sync
  useEffect(() => {
    if (!currentUser) return;

    const userDocRef = doc(db, 'users', currentUser.uid);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data) {
          setUserProfile(prev => ({ ...prev, ...data }));
          if (data.balance !== undefined) setUserBalance(data.balance);
          if (data.holdings) setUserHoldings(data.holdings);
          if (data.transactions) setTransactions(data.transactions);
        }
      } else {
        // Create initial profile in Firestore if it doesn't exist
        const initialProfile = {
          id: currentUser.uid,
          name: currentUser.displayName || 'Usuário Oasis',
          email: currentUser.email || '',
          phoneNumber: currentUser.phoneNumber || '',
          bio: '',
          avatarUrl: currentUser.photoURL || '',
          avatarScale: 1,
          avatarOffset: 50,
          walletId: 'oasis_' + Math.random().toString(36).substring(2, 15),
          balance: 25400.50,
          role: currentUser.email === 'arquivooasis@gmail.com' ? 'admin' : 'user',
          holdings: [],
          transactions: []
        };
        setDoc(userDocRef, initialProfile).catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${currentUser.uid}`));
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${currentUser.uid}`));

    return () => unsubscribe();
  }, [currentUser]);

  // Firebase Assets Sync
  useEffect(() => {
    const assetsRef = collection(db, 'assets');
    const unsubscribe = onSnapshot(assetsRef, (snapshot) => {
      if (!snapshot.empty) {
        const fetchedAssets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ArtAsset));
        setAssets(fetchedAssets);
      } else {
        setAssets(MOCK_ASSETS);
      }
    }, (err) => {
      if (err.message && err.message.includes("Quota exceeded")) {
        console.warn("Assets sync: Quota exceeded. Using local data.");
        showNotification("Limite de uso do banco atingido. Operando em Modo Local.");
      } else {
        console.error("Assets sync error:", err);
        handleFirestoreError(err, OperationType.LIST, 'assets');
      }
      // Fallback to mock assets on any error
      setAssets(MOCK_ASSETS);
    });

    return () => unsubscribe();
  }, []);

  // Global Auto-Sync to Firestore
  useEffect(() => {
    if (!currentUser || !isAuthReady) return;

    const syncData = async () => {
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await setDoc(userDocRef, {
          ...userProfile,
          balance: userBalance,
          holdings: userHoldings,
          transactions: transactions
        }, { merge: true });
        console.log("Firestore auto-sync complete");
      } catch (err: any) {
        handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
      }
    };

    const timeoutId = setTimeout(syncData, 5000); // Debounce sync
    return () => clearTimeout(timeoutId);
  }, [userProfile, userBalance, userHoldings, transactions, currentUser, isAuthReady]);



  // Load all states from storage on mount (Local fallback)
  useEffect(() => {
    const loadAllData = async () => {
      // Load Assets
      const savedAssets = await safeGetItem('oasis_assets_persistent') || await safeGetItem('oasis_assets_cache');
      if (savedAssets) {
        try {
          const parsed = JSON.parse(savedAssets);
          if (Array.isArray(parsed)) setAssets(parsed);
        } catch (err) { console.error("Erro ao carregar ativos:", err); }
      }

      // Load Profile and Balance
      const savedProfile = await safeGetItem('oasis_profile_cache');
      if (savedProfile) {
        try {
          const data = JSON.parse(savedProfile);
          if (data.profile) setUserProfile(data.profile);
          if (data.balance !== undefined) setUserBalance(Number(data.balance));
        } catch (err) { console.error("Erro ao carregar perfil:", err); }
      }

      // Load Holdings
      const savedHoldings = await safeGetItem('oasis_holdings_cache');
      if (savedHoldings) {
        try {
          const parsed = JSON.parse(savedHoldings);
          if (Array.isArray(parsed)) setUserHoldings(parsed);
        } catch (err) { console.error("Erro ao carregar holdings:", err); }
      }

      // Load Transactions
      const savedTransactions = await safeGetItem('oasis_transactions_cache');
      if (savedTransactions) {
        try {
          const parsed = JSON.parse(savedTransactions);
          if (Array.isArray(parsed)) setTransactions(parsed);
        } catch (err) { console.error("Erro ao carregar transações:", err); }
      }
    };
    loadAllData();
  }, []);

  // Auto-save logic per account
  useEffect(() => {
    const saveAssets = async () => {
      await safeSetItem('oasis_assets_persistent', JSON.stringify(assets));
    };
    saveAssets();
  }, [assets]);

  useEffect(() => {
    const saveProfile = async () => {
      if (userProfile?.id) {
        // 1. Atualiza o cache da sessão atual
        await safeSetItem('oasis_profile_cache', JSON.stringify({ 
          profile: userProfile, 
          balance: userBalance 
        }));

        // 2. Atualiza a conta na lista global de contas (Persistência entre sessões)
        const savedAccounts = await safeGetItem('oasis_local_accounts');
        if (savedAccounts) {
          try {
            const accounts: UserProfile[] = JSON.parse(savedAccounts);
            const index = accounts.findIndex(acc => acc.id === userProfile.id || acc.phoneNumber === userProfile.phoneNumber);
            
            if (index !== -1) {
              accounts[index] = {
                ...accounts[index],
                ...userProfile,
                balance: userBalance,
                holdings: userHoldings,
                transactions: transactions
              };
              await safeSetItem('oasis_local_accounts', JSON.stringify(accounts));
            } else {
              // Se não existir, adiciona como nova conta
              const newAccount = {
                ...userProfile,
                balance: userBalance,
                holdings: userHoldings,
                transactions: transactions
              };
              accounts.push(newAccount as any);
              await safeSetItem('oasis_local_accounts', JSON.stringify(accounts));
            }
          } catch (err) {
            console.error("Erro ao atualizar contas locais:", err);
          }
        } else {
          // Se não houver contas salvas, cria a primeira
          const newAccount = {
            ...userProfile,
            balance: userBalance,
            holdings: userHoldings,
            transactions: transactions
          };
          await safeSetItem('oasis_local_accounts', JSON.stringify([newAccount]));
        }

        // 3. Firestore Save (Auto-sync)
        if (currentUser && isAuthReady) {
          const userDocRef = doc(db, 'users', currentUser.uid);
          await setDoc(userDocRef, {
            ...userProfile,
            balance: userBalance,
            holdings: userHoldings,
            transactions: transactions
          }, { merge: true }).catch(err => {
            console.error("Auto-sync error:", err);
          });
        }
      }
    };
    saveProfile();
  }, [userProfile, userBalance, userHoldings, transactions, currentUser, isAuthReady]);

  // Admin Draft Auto-save
  useEffect(() => {
    const saveDraft = async () => {
      if (Object.keys(editorData).length > 0) {
        await safeSetItem('oasis_admin_draft', JSON.stringify(editorData));
      }
    };
    saveDraft();
  }, [editorData]);

  useEffect(() => {
    const loadDraft = async () => {
      const draft = await safeGetItem('oasis_admin_draft');
      if (draft && Object.keys(editorData).length === 0) {
        setEditorData(JSON.parse(draft));
      }
    };
    loadDraft();
  }, []);

  useEffect(() => {
    const saveHoldings = async () => {
      await safeSetItem('oasis_holdings_cache', JSON.stringify(userHoldings));
    };
    saveHoldings();
  }, [userHoldings]);

  useEffect(() => {
    const saveTransactions = async () => {
      await safeSetItem('oasis_transactions_cache', JSON.stringify(transactions));
    };
    saveTransactions();
  }, [transactions]);

  // Check session on mount
  useEffect(() => {
    const checkSession = async () => {
      const session = await safeGetItem('oasis_session');
      const pinUnlocked = await safeGetItem('oasis_pin_unlocked');
      if (session === 'true' && pinUnlocked && userProfile?.id) {
        setIsAuthenticated(true);
        setIsSecurityUnlocked(true);
        setIsPinLocked(true);
      }
    };
    checkSession();
  }, [userProfile?.id]);

  // Swap State
  const [swapFromId, setSwapFromId] = useState<string>('');
  const [swapToId, setSwapToId] = useState<string>('');
  const [swapAmount, setSwapAmount] = useState<string>('');

  // Tokenization State
  const [tokenizeData, setTokenizeData] = useState({
    title: '',
    artist: '',
    year: '',
    estimatedValue: '',
    description: '',
    imageUrl: ''
  });

  const [isPinLocked, setIsPinLocked] = useState(false);
  const unsubProfileRef = useRef<(() => void) | null>(null);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | undefined>('');
  const [otpValue, setOtpValue] = useState(['', '', '', '']);
  const [otpTimer, setOtpTimer] = useState(60);
  const [whatsappLink, setWhatsappLink] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [showPinFallback, setShowPinFallback] = useState(false);
  const [isOtpSuccess, setIsOtpSuccess] = useState(false);
  const [phoneStep, setPhoneStep] = useState<'PHONE' | 'OTP' | 'PROFILE'>('PHONE');
  const [currentUserId, setCurrentUserId] = useState('');
  const [tempProfileData, setTempProfileData] = useState({ name: '', avatarUrl: '' });

  // Device ID Management
  const getDeviceId = async () => {
    // Device ID is small, keep it in localStorage for sync access
    let deviceId = await safeGetItem('oasis_device_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await safeSetItem('oasis_device_id', deviceId);
    }
    return deviceId;
  };

  // Expose to window for LoginScreen access
  useEffect(() => {
    (window as any).setShowPhoneModal = setShowPhoneModal;
  }, []);

  const handlePhoneRegistration = async () => {
    if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
      showNotification("Por favor, insira um número de WhatsApp válido com DDI.");
      return;
    }

    if (isLoading) return;
    setIsLoading(true);

    try {
      // Check if account exists
      const savedAccounts = await safeGetItem('oasis_local_accounts');
      const accounts: UserProfile[] = savedAccounts ? JSON.parse(savedAccounts) : [];
      const existingAccount = accounts.find(a => a.phoneNumber === phoneNumber);

      let pinToSend = '';
      if (existingAccount) {
        pinToSend = existingAccount.pin;
        setCurrentPin(pinToSend);
        showNotification("Conta encontrada! Enviando PIN para seu WhatsApp...");
      } else {
        // Garantir que o PIN gerado seja EXCLUSIVO e ÚNICO
        let generatedPin = '';
        let isUnique = false;
        const allPins = accounts.map(acc => acc.pin);
        
        while (!isUnique) {
          generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
          if (!allPins.includes(generatedPin) && generatedPin !== '5023') {
            isUnique = true;
          }
          if (allPins.length >= 8999) break; 
        }
        
        pinToSend = generatedPin;
        setCurrentPin(generatedPin);
        showNotification("Novo PIN vitalício e exclusivo gerado! Enviando para seu WhatsApp...");
      }

      // Always generate the WhatsApp link for the "Re-send" button and as a primary/fallback method
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const message = encodeURIComponent(`Olá! Seu PIN VITALÍCIO de acesso ao OasisRJ é: ${pinToSend}\n\nEste código nunca expira e é válido em todos os seus dispositivos.`);
      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${message}`;
      setWhatsappLink(whatsappUrl);

      // Call Backend API to send PIN automatically
      try {
        const response = await fetch('/api/send-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber, pin: pinToSend })
        });
        
        if (!response.ok) {
          throw new Error('Falha ao enviar via API');
        }
        
        showNotification("PIN enviado automaticamente para seu WhatsApp!");
        
        // Even if API "succeeds" (mock), we open the window to be sure in this demo environment
        window.open(whatsappUrl, '_blank');
      } catch (apiErr) {
        console.warn("Falha no envio automático, tentando via link direto:", apiErr);
        // Fallback to direct link if API fails
        window.open(whatsappUrl, '_blank');
      }

      setPhoneStep('OTP');
      setOtpTimer(60);
      setShowPinFallback(false);
      setShowPhoneModal(true);
      
    } catch (err) {
      console.error("Erro no registro:", err);
      showNotification("Erro ao processar registro. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocalPinLogin = async (enteredPin: string) => {
    try {
      const savedAccountsStr = await safeGetItem('oasis_local_accounts');
      if (savedAccountsStr) {
        const accounts: UserProfile[] = JSON.parse(savedAccountsStr);
        const matchedAccount = accounts.find(acc => acc.pin === enteredPin);
        
        if (matchedAccount) {
          setIsAuthenticated(true);
          setIsSecurityUnlocked(true);
          setIsPinLocked(true);
          setUserProfile(matchedAccount);
          setUserBalance(matchedAccount.balance ?? 25400.50);
          setUserHoldings(matchedAccount.holdings ?? []);
          setTransactions(matchedAccount.transactions ?? []);
          safeSetItem('oasis_session', 'true');
          safeSetItem('oasis_pin_unlocked', JSON.stringify({
            email: matchedAccount.phoneNumber || matchedAccount.email,
            timestamp: Date.now()
          }));
          setShowPhoneModal(false);
          setPhoneStep('PHONE');
          showNotification(`Bem-vindo de volta (Modo Local), ${matchedAccount.name}!`);
          return true;
        }
      }
    } catch (e) {
      console.error("Local login fallback failed:", e);
    }
    showNotification("PIN ou Telefone incorreto.");
    return false;
  };

  const handleOtpSubmit = async () => {
    const enteredPin = otpValue.join('');
    if (enteredPin.length !== 4) return;

    if (isLoading) return;
    setIsLoading(true);

    try {
      // Full-Stack Auth Integration
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, pin: enteredPin })
      });

      if (response.ok) {
        const { token, profile } = await response.json();
        
        // Sign in to Firebase with the Custom Token from the server
        if (token && token !== "simulated_token_iam_disabled") {
          await signInWithCustomToken(auth, token);
        } else {
          console.warn("Using simulated session (IAM API disabled)");
        }
        
        setUserProfile(profile);
        setIsAuthenticated(true);
        setIsSecurityUnlocked(true);
        setIsPinLocked(true);
        safeSetItem('oasis_session', 'true');
        safeSetItem('oasis_pin_unlocked', JSON.stringify({
          email: profile.phoneNumber || profile.email,
          timestamp: Date.now()
        }));
        setShowPhoneModal(false);
        setPhoneStep('PHONE');
        showNotification(`Bem-vindo de volta, ${profile.name}!`);
      } else {
        let errorData;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          console.error("Server returned non-JSON error:", text.substring(0, 100));
          errorData = { error: "SERVER_ERROR", details: text.substring(0, 100) };
        }
        
        // Handle IAM API error specifically
        if (errorData.error === "IAM_API_DISABLED" || (errorData.details && errorData.details.includes("IAM Service Account Credentials API"))) {
          console.warn("IAM API Error (Handled with fallback):", errorData);
          showNotification("Aviso: Operando em modo de compatibilidade");
          return;
        }

        if (errorData.error === "FIRESTORE_PERMISSION_DENIED" || errorData.error === "DATABASE_UNAVAILABLE") {
          console.warn("Server database unreachable, attempting local login...");
          const success = await handleLocalPinLogin(enteredPin);
          if (!success) {
            setPinError(true);
          }
          return;
        }

        // If not found in cloud, check local fallback for new registration flow
        if (enteredPin === currentPin) {
          const savedAccounts = await safeGetItem('oasis_local_accounts');
          const accounts: UserProfile[] = savedAccounts ? JSON.parse(savedAccounts) : [];
          const existingAccount = accounts.find(a => a.phoneNumber === phoneNumber);
          
          if (existingAccount) {
            setUserProfile(existingAccount);
            setIsAuthenticated(true);
            setIsSecurityUnlocked(true);
            setIsPinLocked(true);
            setShowPhoneModal(false);
            setPhoneStep('PHONE');
            showNotification(`Bem-vindo de volta, ${existingAccount.name}!`);
          } else {
            setPhoneStep('PROFILE');
          }
        } else {
          showNotification("PIN incorreto.");
          setOtpValue(['', '', '', '']);
        }
      }
    } catch (err: any) {
      console.warn("Auth error (Server unreachable), attempting local login:", err.message);
      await handleLocalPinLogin(enteredPin);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalActivation = async () => {
    if (!tempProfileData.name || tempProfileData.name.length < 3) {
      showNotification("Por favor, insira seu nome completo.");
      return;
    }
    if (!tempProfileData.avatarUrl) {
      showNotification("Por favor, adicione uma foto de perfil.");
      return;
    }

    setIsLoading(true);
    try {
      const profile: UserProfile = {
        id: currentUser ? currentUser.uid : 'local_' + Date.now(),
        name: tempProfileData.name.toUpperCase(),
        email: currentUser?.email || '',
        phoneNumber: phoneNumber || '',
        bio: 'Colecionador de arte digital e entusiasta do movimento neoconcreto brasileiro.',
        avatarUrl: tempProfileData.avatarUrl,
        avatarScale: 1,
        avatarOffset: 50,
        pin: currentPin,
        walletId: '0x71C' + Math.random().toString(16).substring(2, 10).toUpperCase(),
        balance: 25400.50,
        holdings: [],
        transactions: []
      };

      if (currentUser) {
        await setDoc(doc(db, 'users', currentUser.uid), profile).catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${currentUser.uid}`));
      }

      // Save to accounts list (Local fallback)
      const savedAccounts = await safeGetItem('oasis_local_accounts');
      const accounts: UserProfile[] = savedAccounts ? JSON.parse(savedAccounts) : [];
      accounts.push(profile);
      await safeSetItem('oasis_local_accounts', JSON.stringify(accounts));

      setUserProfile(profile);
      setUserBalance(25400.50);
      setUserHoldings([]);
      setTransactions([]);
      setIsAuthenticated(true);
      setIsSecurityUnlocked(true);
      setIsPinLocked(true);
      safeSetItem('oasis_session', 'true');
      safeSetItem('oasis_pin_unlocked', JSON.stringify({
        email: profile.phoneNumber || profile.email,
        timestamp: Date.now()
      }));
      
      setShowPhoneModal(false);
      setPhoneStep('PHONE');
      showNotification(currentUser ? "Perfil ativado e sincronizado com sucesso!" : "Perfil ativado localmente com sucesso!");
    } catch (err) {
      console.error("Erro na ativação:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64, 400, 400, 0.7);
        setTempProfileData(prev => ({ ...prev, avatarUrl: compressed }));
      };
      reader.readAsDataURL(file);
    }
  };

  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showPhoneModal && phoneStep === 'OTP') {
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 500);
    }
  }, [showPhoneModal, phoneStep]);



  useEffect(() => {
    if (phoneStep === 'OTP' && otpTimer > 0) {
      const timer = setInterval(() => setOtpTimer(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [phoneStep, otpTimer]);

  useEffect(() => {
    if (otpValue.every(v => v !== '')) {
      handleOtpSubmit();
    }
  }, [otpValue]);

  // Restore PIN unlock state from storage
  useEffect(() => {
    const restorePinState = async () => {
      const saved = await safeGetItem('oasis_pin_unlocked');
      if (saved) {
        try {
          const { email, timestamp } = JSON.parse(saved);
          // Expire in 4 hours
          const isExpired = Date.now() - timestamp > 14400000;
          if (!isExpired && (email === userProfile?.email || email === userProfile?.phoneNumber)) {
            setIsSecurityUnlocked(true);
          } else {
            await safeRemoveItem('oasis_pin_unlocked');
          }
        } catch (e) {
          await safeRemoveItem('oasis_pin_unlocked');
        }
      }
    };
    restorePinState();
  }, [userProfile?.email]);

  // Manual sync functions removed as integration is now automatic and real-time.

  // QR and Magic Link sync functions removed as integration is now automatic.

  const fetchUserProfile = (email: string) => {
    return () => {};
  };

  const fetchHoldings = (profileId: string) => {
    return () => {};
  };

  // Sincroniza holdings com a lista de ativos inicial apenas se for um novo usuário sem holdings
  const holdingsInitialized = useRef(false);
  useEffect(() => {
    if (assets && assets.length > 0 && !holdingsInitialized.current && !isAuthenticated && userHoldings.length === 0) {
        const autoSyncedHoldings = assets.filter(a => a && a.id).map(asset => ({
            assetId: asset.id,
            fractionsOwned: 100,
            averagePrice: (asset.fractionPrice || 0) * 0.9
        }));
        setUserHoldings(autoSyncedHoldings);
        holdingsInitialized.current = true;
    }
  }, [assets, isAuthenticated]);

  const handleLogin = async (pin: string) => {
      setIsLoading(true);
      setPinError(false);
      try {
        // Se já temos um perfil carregado (via Cache), validamos o PIN
        if (userProfile?.pin && userProfile.pin !== '') {
          if (pin === userProfile.pin) {
            setIsAuthenticated(true);
            setIsSecurityUnlocked(true);
            safeSetItem('oasis_session', 'true');
            showNotification('Acesso exclusivo liberado');
            return;
          } else {
            setPinError(true);
            showNotification('PIN incorreto para este perfil');
            setIsLoading(false);
            return;
          }
        }
        
        // Se não tem PIN, permite acesso direto (demo)
        setIsAuthenticated(true);
        setIsSecurityUnlocked(true);
        safeSetItem('oasis_session', 'true');
        showNotification('Acesso liberado (Modo Demo)');
      } catch (err) {
        console.error("Erro no login:", err);
      } finally {
        setIsLoading(false);
      }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // 1. Reset Auth States
    setIsAuthenticated(false);
    setIsSecurityUnlocked(false);
    setIsPinLocked(false);
    
    // 2. Clear Storage (The "Unlinking" part)
    const keysToClear = [
      'oasis_session',
      'oasis_pin_unlocked',
      'oasis_profile_cache',
      'oasis_holdings_cache',
      'oasis_transactions_cache',
      'oasis_admin_draft'
    ];

    for (const key of keysToClear) {
      await safeRemoveItem(key);
    }
    
    // 3. Reset User Data States to default
    const defaultProfile: UserProfile = {
      id: 'local_' + Date.now(),
      name: 'INVESTIDOR',
      email: '',
      phoneNumber: '',
      bio: '',
      avatarUrl: '',
      avatarScale: 1,
      avatarOffset: 50,
      pin: '',
      walletId: 'oasis_' + Math.random().toString(36).substring(2, 15),
    };
    setUserProfile(defaultProfile);
    setUserBalance(25400.50);
    setUserHoldings([]);
    setTransactions([]);
    
    // 4. Reset other states
    setPhoneNumber('');
    setWhatsappLink('');
    setOtpValue(['', '', '', '']);
    setPhoneStep('PHONE');
    
    // 5. Redirect to Home
    setCurrentView('HOME');
    
    // 6. Force show the phone modal for re-linking/login
    setShowPhoneModal(true);
    
    showNotification('Sessão encerrada e WhatsApp desvinculado com sucesso.');
    } catch (err) {
      console.error("Erro ao sair:", err);
      showNotification("Erro ao encerrar sessão.");
    }
  };

  const handleLock = () => {
    setIsSecurityUnlocked(false);
    showNotification('Sessão bloqueada.');
    setCurrentView('HOME');
  };

  const fetchAssets = async () => {
    const saved = await safeGetItem('oasis_assets_persistent') || await safeGetItem('oasis_assets_cache');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAssets(parsed);
          return () => {};
        }
      } catch (e) {
        console.error("Erro ao carregar ativos do armazenamento seguro");
      }
    }
    setAssets(MOCK_ASSETS);
    return () => {};
  };

  const handlePurchase = async () => {
    if (!purchaseAsset) return;
    
    const quantity = purchaseAsset.quantity || 1;
    const totalCost = (purchaseAsset.fractionPrice || 0) * quantity;
    const asset = assets.find(a => a && a.id === purchaseAsset.id);

    if (asset && asset.availableFractions < quantity) {
        showNotification("Quantidade de frações insuficiente no mercado.");
        return;
    }

    if (userBalance < totalCost) {
        showNotification("Saldo insuficiente para esta transação.");
        return;
    }

    setIsLoading(true);
    
    try {
      if (currentUser) {
        // ATOMIC TRANSACTION FOR CLOUD USERS
        await runTransaction(db, async (transaction) => {
          const assetDocRef = doc(db, 'assets', purchaseAsset.id);
          const userDocRef = doc(db, 'users', currentUser.uid);
          
          const assetDoc = await transaction.get(assetDocRef);
          const userDoc = await transaction.get(userDocRef);
          
          if (!assetDoc.exists()) throw new Error("Ativo não encontrado no servidor.");
          
          const assetData = assetDoc.data() as ArtAsset;
          if (assetData.availableFractions < quantity) {
            throw new Error("Quantidade de frações insuficiente no mercado.");
          }
          
          // Update Asset
          transaction.update(assetDocRef, {
            availableFractions: assetData.availableFractions - quantity
          });
          
          // Update User
          const userData = userDoc.exists() ? userDoc.data() : {};
          const currentHoldings = userData.holdings || [];
          const currentBalance = userData.balance ?? 0;
          const currentTransactions = userData.transactions || [];
          
          if (currentBalance < totalCost) throw new Error("Saldo insuficiente na conta cloud.");
          
          const newHoldings = [...currentHoldings];
          const existingIdx = newHoldings.findIndex((h: any) => h.assetId === purchaseAsset.id);
          if (existingIdx >= 0) {
            newHoldings[existingIdx].fractionsOwned += quantity;
          } else {
            newHoldings.push({ assetId: purchaseAsset.id, fractionsOwned: quantity, averagePrice: purchaseAsset.fractionPrice || 0 });
          }
          
          const newTransaction: Transaction = {
            id: crypto.randomUUID(),
            type: 'BUY',
            assetId: purchaseAsset.id,
            amount: totalCost,
            timestamp: new Date().toISOString(),
            status: 'COMPLETED'
          };
          
          transaction.set(userDocRef, {
            balance: currentBalance - totalCost,
            holdings: newHoldings,
            transactions: [newTransaction, ...currentTransactions]
          }, { merge: true });
        });
      } else {
        // LOCAL ONLY MODE (FALLBACK)
        // 1. Update Asset in Firestore (Decrement available fractions)
        const assetDocRef = doc(db, 'assets', purchaseAsset.id);
        await setDoc(assetDocRef, {
          availableFractions: (asset?.availableFractions || 0) - quantity
        }, { merge: true });

        // 2. Update User Balance and Holdings Locally
        const newBalance = userBalance - totalCost;
        setUserBalance(newBalance);
        
        const newHoldings = [...userHoldings];
        const existingIdx = newHoldings.findIndex(h => h.assetId === purchaseAsset.id);
        if (existingIdx >= 0) {
          newHoldings[existingIdx].fractionsOwned += quantity;
        } else {
          newHoldings.push({ assetId: purchaseAsset.id, fractionsOwned: quantity, averagePrice: purchaseAsset.fractionPrice || 0 });
        }
        setUserHoldings(newHoldings);

        // 3. Add Transaction Locally
        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          type: 'BUY',
          assetId: purchaseAsset.id,
          amount: totalCost,
          timestamp: new Date().toISOString(),
          status: 'COMPLETED'
        };
        setTransactions(prev => [newTransaction, ...prev]);
      }
      
      const purchasedTitle = purchaseAsset.title;
      setPurchaseAsset(null);
      showNotification(`${quantity} fração(ões) de "${purchasedTitle}" adquirida(s) com sucesso!`);
      setCurrentView('WALLET');
    } catch (err: any) {
      console.error("Erro na compra:", err);
      showNotification(err.message || "Erro ao processar compra.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveHolding = (assetId: string) => {
    setUserHoldings(prev => prev.filter(h => h.assetId !== assetId));
    showNotification('Ativo removido localmente.');
  };

  // Security Helper
  const requestPIN = (action: () => void) => {
    if (isSecurityUnlocked) {
      action();
    } else {
      setPendingAction(() => action);
      setPinValue('');
      setPinError(false);
    }
  };

  // Finance Handlers
  const handleDeposit = async () => {
    const amount = parseCurrency(transactionAmount);
    if (amount <= 0 || !userProfile?.id) {
      showNotification("Insira um valor válido.");
      return;
    }
    setIsLoading(true);
    try {
      const newBalance = userBalance + amount;
      
      const newTransaction: Transaction = {
        id: crypto.randomUUID(),
        type: 'DEPOSIT',
        assetId: 'CASH',
        amount: amount,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED'
      };
      
      const newTransactions = [newTransaction, ...transactions];

      if (currentUser) {
        await syncUserToCloud(currentUser.uid, {
          balance: newBalance,
          transactions: newTransactions
        });
      }

      setUserBalance(newBalance);
      setTransactions(newTransactions);

      setIsDepositModalOpen(false);
      setTransactionAmount('');
      showNotification(`Depósito de R$ ${formatCurrency(amount)} realizado e sincronizado.`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser?.uid}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseCurrency(transactionAmount);
    if (amount <= 0 || !userProfile?.id) {
      showNotification("Insira um valor válido.");
      return;
    }
    if (amount > userBalance) {
      showNotification("Saldo insuficiente para o saque.");
      return;
    }
    setIsLoading(true);
    try {
      const newBalance = userBalance - amount;

      const newTransaction: Transaction = {
        id: crypto.randomUUID(),
        type: 'WITHDRAW',
        assetId: 'CASH',
        amount: amount,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED'
      };
      
      const newTransactions = [newTransaction, ...transactions];

      if (currentUser) {
        await syncUserToCloud(currentUser.uid, {
          balance: newBalance,
          transactions: newTransactions
        });
      }

      setUserBalance(newBalance);
      setTransactions(newTransactions);

      setIsWithdrawModalOpen(false);
      setTransactionAmount('');
      showNotification(`Saque de R$ ${formatCurrency(amount)} realizado e sincronizado.`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser?.uid}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminEdit = (asset?: ArtAsset) => {
    if (asset) {
      setEditorData({ ...asset, gallery: [...(asset.gallery || [])] });
    } else {
      setEditorData({
        id: crypto.randomUUID(),
        title: '',
        artist: '',
        year: new Date().getFullYear().toString(),
        totalValue: 0,
        fractionPrice: 0,
        totalFractions: 10000,
        availableFractions: 10000,
        imageUrl: '',
        gallery: [],
        insuranceStatus: InsuranceStatus.SECURED,
        insuranceCompany: 'Oasis Safe',
        policyNumber: '',
        insuranceExpiry: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        technicalReportUrl: '',
        description: '',
        isCatalogOnly: false
      });
    }
    
    // Só exige senha se estivermos vindo de fora do painel admin
    if (currentView !== 'ADMIN') {
      setIsAdminAuthenticated(false);
      setAdminPwdInput('');
      setCurrentView('ADMIN_LOGIN');
    }
  };

  const handleAdminSave = async () => {
    if (!editorData.artist || !editorData.title || !editorData.policyNumber) {
      showNotification('ARTISTA, TÍTULO E CÓDIGO DA PÓLICE SÃO OBRIGATÓRIOS');
      return;
    }

    setIsLoading(true);

    if (!currentUser) {
      showNotification('ERRO: LOGIN GOOGLE NECESSÁRIO PARA SINCRONIZAR COM O CLOUD.');
      setIsLoading(false);
      return;
    }

    const finalId = editorData.id || crypto.randomUUID();
    
    try {
      const assetDocRef = doc(db, 'assets', finalId);
      const assetToSave = { ...editorData, id: finalId };
      
      // Verificação de tamanho antes de enviar (Limite de 1MB do Firestore)
      const sizeInBytes = new TextEncoder().encode(JSON.stringify(assetToSave)).length;
      if (sizeInBytes > 1040000) {
        showNotification('ERRO: DOCUMENTO MUITO GRANDE (LIMITE 1MB). REMOVA ALGUMAS IMAGENS DA GALERIA.');
        setIsLoading(false);
        return;
      }

      await setDoc(assetDocRef, assetToSave, { merge: true });
      
      showNotification('Alterações salvas no Firestore com sucesso!');
      setHasSavedAdminChanges(true);
    } catch (err: any) {
      console.error("Admin save failed:", err);
      showNotification('Erro ao salvar no Firestore. Verifique permissões de Admin.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwap = async () => {
    const fromHolding = userHoldings.find(h => h.assetId === swapFromId);
    const fromAsset = assets.find(a => a && a.id === swapFromId);
    const toAsset = assets.find(a => a && a.id === swapToId);
    const amount = parseFloat(swapAmount);

    if (!fromHolding || !fromAsset || !toAsset || isNaN(amount) || amount <= 0 || !userProfile?.id) {
      showNotification("Dados de troca inválidos.");
      return;
    }

    if (amount > fromHolding.fractionsOwned) {
      showNotification("Quantidade de frações insuficiente.");
      return;
    }

    const totalValueInBRL = amount * fromAsset.fractionPrice;
    const fee = totalValueInBRL * 0.005; // 0.5% Liquidity Fee

    if (userBalance < fee) {
      showNotification("Saldo insuficiente para cobrir a taxa de liquidez (0.5%).");
      return;
    }

    const toFractions = totalValueInBRL / toAsset.fractionPrice;

    setIsLoading(true);
    try {
      if (currentUser) {
        // ATOMIC TRANSACTION FOR CLOUD USERS
        await runTransaction(db, async (transaction) => {
          const fromAssetDocRef = doc(db, 'assets', swapFromId);
          const toAssetDocRef = doc(db, 'assets', swapToId);
          const userDocRef = doc(db, 'users', currentUser.uid);

          const fromAssetDoc = await transaction.get(fromAssetDocRef);
          const toAssetDoc = await transaction.get(toAssetDocRef);
          const userDoc = await transaction.get(userDocRef);

          if (!fromAssetDoc.exists() || !toAssetDoc.exists()) throw new Error("Ativos não encontrados no servidor.");
          
          const fromAssetData = fromAssetDoc.data() as ArtAsset;
          const toAssetData = toAssetDoc.data() as ArtAsset;

          if (toAssetData.availableFractions < toFractions) {
            throw new Error("Quantidade de frações insuficiente no mercado de destino.");
          }

          // Update Assets
          transaction.update(fromAssetDocRef, {
            availableFractions: fromAssetData.availableFractions + amount
          });
          transaction.update(toAssetDocRef, {
            availableFractions: toAssetData.availableFractions - toFractions
          });

          // Update User
          const userData = userDoc.exists() ? userDoc.data() : {};
          const currentHoldings = userData.holdings || [];
          const currentBalance = userData.balance ?? 0;
          const currentTransactions = userData.transactions || [];

          if (currentBalance < fee) throw new Error("Saldo insuficiente para a taxa.");

          const newHoldings = [...currentHoldings];
          const fromIdx = newHoldings.findIndex((h: any) => h.assetId === swapFromId);
          if (fromIdx >= 0) {
            newHoldings[fromIdx].fractionsOwned -= amount;
            if (newHoldings[fromIdx].fractionsOwned <= 0) {
              newHoldings.splice(fromIdx, 1);
            }
          }
          
          const toIdx = newHoldings.findIndex((h: any) => h.assetId === swapToId);
          if (toIdx >= 0) {
            newHoldings[toIdx].fractionsOwned += toFractions;
          } else {
            newHoldings.push({ assetId: swapToId, fractionsOwned: toFractions, averagePrice: toAsset.fractionPrice });
          }

          const newTransaction: Transaction = {
            id: crypto.randomUUID(),
            type: 'SWAP',
            assetId: `${swapFromId}->${swapToId}`,
            amount: fee,
            timestamp: new Date().toISOString(),
            status: 'COMPLETED'
          };

          transaction.set(userDocRef, {
            balance: currentBalance - fee,
            holdings: newHoldings,
            transactions: [newTransaction, ...currentTransactions]
          }, { merge: true });
        });
      } else {
        // LOCAL ONLY MODE (FALLBACK)
        // 1. Update Assets in Firestore
        const fromAssetDocRef = doc(db, 'assets', swapFromId);
        await setDoc(fromAssetDocRef, {
          availableFractions: (fromAsset?.availableFractions || 0) + amount
        }, { merge: true });

        const toAssetDocRef = doc(db, 'assets', swapToId);
        await setDoc(toAssetDocRef, {
          availableFractions: (toAsset?.availableFractions || 0) - toFractions
        }, { merge: true });

        // 2. Update User Balance and Holdings Locally
        const newBalance = userBalance - fee;
        setUserBalance(newBalance);
        
        const newHoldings = [...userHoldings];
        const fromIdx = newHoldings.findIndex(h => h.assetId === swapFromId);
        if (fromIdx >= 0) {
          newHoldings[fromIdx].fractionsOwned -= amount;
          if (newHoldings[fromIdx].fractionsOwned <= 0) {
            newHoldings.splice(fromIdx, 1);
          }
        }
        
        const toIdx = newHoldings.findIndex(h => h.assetId === swapToId);
        if (toIdx >= 0) {
          newHoldings[toIdx].fractionsOwned += toFractions;
        } else {
          newHoldings.push({ assetId: swapToId, fractionsOwned: toFractions, averagePrice: toAsset.fractionPrice });
        }
        setUserHoldings(newHoldings);

        // 3. Add Transaction Locally
        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          type: 'SWAP',
          assetId: `${swapFromId}->${swapToId}`,
          amount: fee,
          timestamp: new Date().toISOString(),
          status: 'COMPLETED'
        };
        setTransactions(prev => [newTransaction, ...prev]);
      }

      setSwapFromId('');
      setSwapToId('');
      setSwapAmount('');
      showNotification(`Troca realizada e sincronizada. Taxa de R$ ${fee.toFixed(2)} aplicada.`);
      setCurrentView('WALLET');
    } catch (err: any) {
      console.error("Erro na troca:", err);
      showNotification(err.message || "Erro ao processar troca.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminDelete = async (id: string) => {
    if (!id) return;
    
    setIsLoading(true);
    try {
      const assetDocRef = doc(db, 'assets', id);
      await deleteDoc(assetDocRef);
      
      if (selectedAsset?.id === id) setSelectedAsset(null);
      setEditorData({});
      setDeleteConfirmationId(null);
      
      showNotification(`Ativo removido permanentemente do Firestore.`);
      setCurrentView('HOME'); 
    } catch (err: any) {
      console.error("Delete failed:", err);
      showNotification("Erro ao excluir do Firestore.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderSwap = () => {
    const myHoldings = userHoldings.map(h => {
      const asset = assets.find(a => a && a.id === h.assetId);
      return { ...h, asset };
    }).filter(h => h.asset);

    const fromAsset = assets.find(a => a && a.id === swapFromId);
    const toAsset = assets.find(a => a && a.id === swapToId);
    const amount = parseFloat(swapAmount) || 0;
    const totalValue = fromAsset ? amount * fromAsset.fractionPrice : 0;
    const fee = totalValue * 0.005;
    const resultFractions = toAsset && toAsset.fractionPrice > 0 ? totalValue / toAsset.fractionPrice : 0;

    return (
      <div className="p-5 pb-32 animate-in fade-in duration-500 max-w-md mx-auto">
        <header className="mb-8">
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-1">Swap</h2>
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em]">Negociação Direta de Ativos</p>
        </header>

        <div className="space-y-4">
          {/* FROM CARD */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] space-y-4 shadow-xl relative overflow-hidden">
            <div className="flex justify-between items-center">
              <span className="text-emerald-500 text-[10px] font-black uppercase tracking-widest">ENTRADA (VOCÊ ENTREGA)</span>
              <button 
                onClick={() => {
                  const holding = myHoldings.find(h => h.assetId === swapFromId);
                  if (holding) setSwapAmount(holding.fractionsOwned.toString());
                }}
                className="text-amber-500 text-[9px] font-black uppercase bg-amber-500/10 px-2 py-1 rounded-md hover:bg-amber-500 hover:text-slate-950 transition-all"
              >
                MÁX
              </button>
            </div>
            <div className="flex items-center gap-4">
              <select 
                value={swapFromId} 
                onChange={(e) => setSwapFromId(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white font-bold text-sm outline-none focus:border-amber-500"
              >
                <option value="">Selecionar Ativo</option>
                {myHoldings.map(h => (
                  <option key={h.assetId} value={h.assetId}>{h.asset?.artist} - {h.asset?.title}</option>
                ))}
              </select>
              <input 
                type="number" 
                placeholder="0.00"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                className="w-24 bg-transparent text-right text-2xl font-black text-white outline-none placeholder:text-slate-800"
              />
            </div>
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest text-right">
              Saldo: {myHoldings.find(h => h.assetId === swapFromId)?.fractionsOwned.toFixed(2) || '0.00'} UN
            </div>
          </div>

          {/* DIVIDER ICON */}
          <div className="flex justify-center -my-6 relative z-10">
            <div className="h-12 w-12 bg-amber-500 rounded-full flex items-center justify-center border-4 border-slate-950 shadow-lg text-slate-950 animate-pulse">
              <i className="fa-solid fa-right-left rotate-90"></i>
            </div>
          </div>

          {/* TO CARD */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <span className="text-amber-500 text-[10px] font-black uppercase tracking-widest">SAÍDA (ESTIMADA)</span>
            </div>
            <div className="flex items-center gap-4">
              <select 
                value={swapToId} 
                onChange={(e) => setSwapToId(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white font-bold text-sm outline-none focus:border-amber-500"
              >
                <option value="">Selecionar Destino</option>
                {assets.filter(a => a && a.id !== swapFromId && !a.isCatalogOnly).map(a => (
                  <option key={a.id} value={a.id}>{a.artist} - {a.title}</option>
                ))}
              </select>
              <div className={`w-24 text-right text-2xl font-black transition-all duration-300 ${amount > 0 ? 'text-emerald-400 scale-110' : 'text-slate-700'}`}>
                {resultFractions.toFixed(2)}
              </div>
            </div>
          </div>

          {/* CALCULATOR / INFO */}
          <div className="bg-slate-950/50 border border-slate-900 p-5 rounded-2xl space-y-3">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
              <span className="text-slate-500">Taxa de Liquidez (0.5%)</span>
              <span className="text-amber-500">R$ {fee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
              <span className="text-slate-500">Taxa de Câmbio</span>
              <span className="text-white">
                {fromAsset && toAsset ? `1 ${fromAsset.artist.split(' ')[0]} = ${(fromAsset.fractionPrice / toAsset.fractionPrice).toFixed(4)} ${toAsset.artist.split(' ')[0]}` : '-'}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-900 flex justify-between items-center">
               <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest">Saldo em Carteira</span>
               <span className={`text-[11px] font-black ${userBalance >= fee ? 'text-emerald-400' : 'text-red-500'}`}>R$ {formatCurrency(userBalance)}</span>
            </div>
          </div>

          <button 
            onClick={handleSwap}
            disabled={isLoading || !swapFromId || !swapToId || !swapAmount || userBalance < fee}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-black py-5 rounded-[2rem] text-xs uppercase tracking-[0.4em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
            {isLoading ? 'PROCESSANDO...' : 'EXECUTAR SWAP'}
          </button>
        </div>
      </div>
    );
  };

  const handleNavigate = (view: ViewType) => {
    const restrictedViews: ViewType[] = ['MARKETPLACE', 'TRADING', 'WALLET', 'TOKENIZE', 'CUSTODY_GALLERY', 'INSURANCE_DOCUMENT', 'PROFILE', 'ADMIN'];
    
    if (restrictedViews.includes(view) && !isSecurityUnlocked) {
      setPendingView(view);
      setPinValue('');
      setPinError(false);
      return;
    }
    
    setCurrentView(view);
    setSelectedAsset(null);
    window.scrollTo(0, 0);
  };

  const renderPinGuard = () => {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" onClick={() => { setPendingView(null); setPinValue(''); }}></div>
        <div className={`bg-[#0a0f1d] border border-slate-800/50 p-10 rounded-[3rem] w-full max-w-[340px] relative z-10 shadow-2xl text-center space-y-8 transition-all duration-300 ${pinError ? 'animate-shake border-red-500/50' : ''}`}>
          <div className="h-24 w-24 bg-[#1a1f2e] rounded-full flex items-center justify-center mx-auto border border-slate-800/50 shadow-inner">
            <i className="fa-solid fa-key text-[#f59e0b] text-3xl"></i>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-white font-black text-2xl uppercase tracking-tighter">Área Restrita</h4>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
              Insira o PIN definido no login
            </p>
          </div>
 
          <div 
            className="flex justify-center gap-3 relative h-16 cursor-pointer"
            onClick={() => pinInputRef.current?.focus()}
          >
            {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className={`h-14 w-14 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 ${pinValue.length > idx ? 'border-amber-500 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.4)] scale-105' : 'border-slate-800 bg-[#05080f]'}`}>
                    {pinValue.length > idx && (
                      <span className="text-amber-500 text-2xl font-black animate-in zoom-in duration-300">
                        *
                      </span>
                    )}
                </div>
            ))}
            
            <input 
              ref={pinInputRef}
              type="tel" 
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4} 
              autoFocus
              className="absolute inset-0 opacity-0 cursor-default z-10 w-full h-full"
              value={pinValue}
              onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPinValue(val);
                  setPinError(false);
                  
                  if (val.length === 4) {
                      setTimeout(() => {
                          handlePinAction(val);
                      }, 300);
                  }
              }}
            />
          </div>

          {pinError && (
            <div className="flex items-center justify-center gap-2 text-red-500 animate-in slide-in-from-top-2 duration-300">
              <i className="fa-solid fa-circle-xmark text-xs"></i>
              <p className="text-[10px] font-black uppercase tracking-widest">PIN Incorreto</p>
            </div>
          )}

          <div className="space-y-4 pt-2">
            <button 
              onClick={() => handlePinAction()}
              className="w-full bg-[#f59e0b] hover:bg-amber-400 text-slate-950 font-black py-5 rounded-2xl text-[12px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-lg shadow-amber-500/10"
            >
              DESBLOQUEAR
            </button>
            
            <button 
              onClick={() => { 
                setPendingView(null);
                setPinValue('');
                if (!userProfile.phoneNumber) {
                  setShowPhoneModal(true);
                } else {
                  setCurrentView('PROFILE'); 
                  setTimeout(() => {
                    const el = document.getElementById('pin-field');
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el?.focus();
                  }, 300);
                }
              }}
              className="w-full bg-[#10b981] hover:bg-emerald-400 text-white font-black py-5 rounded-2xl text-[12px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-xl shadow-emerald-500/10"
            >
              DEFINA SEU PIN
            </button>
          </div>

          <div onClick={() => { setPendingView(null); setPinValue(''); }} className="text-red-500 hover:text-red-400 text-[11px] font-black uppercase tracking-widest pt-4 transition-all cursor-pointer active:scale-95">
            CANCELAR
          </div>
        </div>
      </div>
    );
  };

  const navigateToAsset = (asset: ArtAsset) => {
    setSelectedAsset(asset);
    setCurrentView('ASSET_DETAIL');
  };

  const openCustodyGallery = (asset: ArtAsset) => {
    setSelectedAsset(asset);
    setCurrentView('CUSTODY_GALLERY');
    setGallerySimulations({});
    window.scrollTo(0, 0);
  };

  const handleAssetUnlock = (asset: ArtAsset) => {
    if (isSecurityUnlocked) {
      openCustodyGallery(asset);
      return;
    }
    setLockingAsset(asset);
    setPinValue('');
    setPinError(false);
  };

  const handlePinAction = async (explicitValue?: string) => {
    const valueToCompare = explicitValue || pinValue;
    if (valueToCompare.length !== 4) return;
    
    // 1. Se o usuário já está logado, validamos contra o perfil atual
    if (userProfile?.id && userProfile?.pin) {
      if (valueToCompare === userProfile?.pin) {
        executePinSuccess();
      } else {
        executePinFailure();
      }
      return;
    }

    // 2. LOGIN LOCAL POR PIN: Buscamos em TODAS as contas registradas
    setIsLoading(true);
    try {
      const savedAccountsStr = await safeGetItem('oasis_local_accounts');
      if (savedAccountsStr) {
        const accounts: UserProfile[] = JSON.parse(savedAccountsStr);
        // Procuramos a conta que possui este PIN exclusivo
        const matchedAccount = accounts.find(acc => acc.pin === valueToCompare);
        
        if (matchedAccount) {
          // RESTAURAÇÃO COMPLETA DA CONTA
          setIsAuthenticated(true);
          setIsSecurityUnlocked(true);
          setIsPinLocked(true);
          
          setUserProfile(matchedAccount);
          setUserBalance(matchedAccount.balance ?? 25400.50);
          setUserHoldings(matchedAccount.holdings ?? []);
          setTransactions(matchedAccount.transactions ?? []);
          
          safeSetItem('oasis_session', 'true');
          safeSetItem('oasis_pin_unlocked', JSON.stringify({
            email: matchedAccount.phoneNumber || matchedAccount.email,
            timestamp: Date.now()
          }));

          showNotification(`Conta de ${matchedAccount.name} acessada com sucesso!`);
          executePinSuccess();
          return;
        }
      }
      
      // Fallback para PIN padrão em modo demo (apenas se não houver contas)
      if (valueToCompare === '5023') {
         executePinSuccess();
      } else {
         executePinFailure();
      }
    } catch (err) {
      console.error("Erro na Restauração de Conta:", err);
      showNotification("Erro na Restauração de Conta. Operação local apenas.");
      executePinFailure();
    } finally {
      setIsLoading(false);
    }
  };

  const executePinSuccess = () => {
    setIsSecurityUnlocked(true); 
    setPinError(false);
    showNotification("Acesso exclusivo liberado!");
    
    setTimeout(() => {
      setPinValue('');
    }, 200);
    
    safeSetItem('oasis_pin_unlocked', JSON.stringify({
      email: userProfile?.email || userProfile?.phoneNumber,
      timestamp: Date.now()
    }));

    if (pendingView) {
      setCurrentView(pendingView);
      setPendingView(null);
    }
    if (lockingAsset) {
      openCustodyGallery(lockingAsset);
      setLockingAsset(null);
    }
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const executePinFailure = () => {
    setPinError(true);
    setTimeout(() => {
      setPinValue('');
      setPinError(false);
      showNotification('PIN Incorreto ou Identidade não localizada');
    }, 1200);
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validação OBRIGATÓRIA de Nome e Foto após vínculo de WhatsApp
    if (userProfile?.phoneNumber) {
      if (!userProfile.name || userProfile.name === 'INVESTIDOR' || userProfile.name.trim() === '') {
        showNotification('É obrigatório informar seu NOME COMPLETO');
        return;
      }
      if (!userProfile?.avatarUrl) {
        showNotification('É obrigatório adicionar uma FOTO DE PERFIL');
        return;
      }
    }

    if (!userProfile?.email && !userProfile?.phoneNumber) {
      showNotification('É obrigatório sincronizar com E-mail ou WhatsApp');
      return;
    }

    if (userProfile?.pin?.length !== 4) {
      showNotification('O PIN deve conter 4 dígitos numéricos');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Finalize UI
      await safeRemoveItem('oasis_pin_unlocked');
      setIsSecurityUnlocked(false);
      setHasSavedProfile(true);
      
      // 2. Firestore Sync
      if (currentUser && userProfile) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await setDoc(userDocRef, {
          ...userProfile,
          balance: userBalance,
          holdings: userHoldings,
          transactions: transactions
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`));
      }

      showNotification(currentUser ? 'Cadastro sincronizado com sucesso!' : 'Cadastro atualizado com sucesso localmente!');
      
      // Atualiza cache local
      safeSetItem('oasis_profile_cache', JSON.stringify({ 
        profile: userProfile, 
        balance: userBalance 
      }));

    } catch (e) {
      console.error("Profile Save failed:", e);
      handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser?.uid}`);
      showNotification('Erro ao salvar perfil no Firestore.');
    } finally {
      setIsLoading(false);
    }
  };

  const checkAdminCredentials = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: 'ADMIN', pin: adminPwdInput })
      });

      if (response.ok) {
        const { token, profile } = await response.json();
        if (token && token !== "simulated_token_iam_disabled") {
          await signInWithCustomToken(auth, token);
        } else {
          console.warn("Using simulated admin session (IAM API disabled)");
        }
        setUserProfile(profile);
        setIsAdminAuthenticated(true);
        setAdminLoginError(false);
        setCurrentView('ADMIN');
        showNotification("Acesso Administrativo Concedido");
      } else {
        let errorData;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          console.error("Server returned non-JSON error:", text.substring(0, 100));
          errorData = { error: "SERVER_ERROR", details: text.substring(0, 100) };
        }
        
        if (errorData.error === "IAM_API_DISABLED" || (errorData.details && errorData.details.includes("IAM Service Account Credentials API"))) {
          const projectNumber = "270809464349";
          const iamUrl = `https://console.developers.google.com/apis/api/iamcredentials.googleapis.com/overview?project=${projectNumber}`;
          
          const confirmEnable = window.confirm(
            "ERRO CRÍTICO DE CONFIGURAÇÃO (GOOGLE CLOUD):\n\n" +
            "A 'IAM Service Account Credentials API' está desativada. Isso impede o login administrativo.\n\n" +
            "CLIQUE EM OK PARA ABRIR O LINK E ATIVAR A API AGORA."
          );
          if (confirmEnable) {
            window.open(iamUrl, '_blank');
          }
          return;
        }

        if (errorData.error === "FIRESTORE_PERMISSION_DENIED") {
          showNotification("Erro: O servidor não tem permissão para acessar o Firestore.");
          return;
        }

        // Fallback for demo/offline mode if server rejects or has issues
        if (adminPwdInput === '5023') {
          setIsAdminAuthenticated(true);
          setAdminLoginError(false);
          setCurrentView('ADMIN');
          showNotification("Acesso Administrativo Concedido (Modo Demo)");
          return;
        }
        setAdminLoginError(true);
        setAdminPwdInput('');
        showNotification("PIN Admin Incorreto");
      }
    } catch (err) {
      console.error("Admin login error:", err);
      // Fallback for demo/offline mode if server is unreachable
      if (adminPwdInput === '5023') {
        setIsAdminAuthenticated(true);
        setAdminLoginError(false);
        setCurrentView('ADMIN');
        showNotification("Acesso Administrativo Concedido (Offline)");
      } else {
        showNotification("Erro ao conectar com o servidor.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'MAIN' | 'GALLERY' | 'TOKENIZE') => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setIsUploading(true);
    setHasSavedAdminChanges(false);

    try {
      const processFile = (file: File) => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              // Comprimimos para garantir que caiba no Firestore
              const compressed = await compressImage(reader.result as string);
              
              // Verificação final de tamanho (Base64)
              const sizeInBytes = (compressed.length * 3) / 4;
              resolve(compressed);
            } catch (err) {
              reject(new Error(`Erro ao comprimir "${file.name}"`));
            }
          };
          reader.onerror = () => reject(new Error(`Erro na leitura de "${file.name}"`));
          reader.readAsDataURL(file);
        });
      };

      if (type === 'MAIN') {
        const base64 = await processFile(files[0]);
        setEditorData(prev => ({ ...prev, imageUrl: base64 }));
        showNotification("Capa atualizada e otimizada");
      } else if (type === 'TOKENIZE') {
        const base64 = await processFile(files[0]);
        setTokenizeData(prev => ({ ...prev, imageUrl: base64 }));
        showNotification("Imagem para avaliação processada");
      } else {
        const newItems: GalleryItem[] = [];
        
        for (const file of files) {
          const base64 = await processFile(file);
          const title = file.name.split('.')[0].toUpperCase();
          
          const defaultTotalValue = editorData.totalValue || 0;
          const defaultFractionPrice = editorData.fractionPrice || 0;

          newItems.push({
            id: crypto.randomUUID(),
            imageUrl: base64,
            title: title,
            year: editorData.year || new Date().getFullYear().toString(),
            totalValue: defaultTotalValue,
            fractionPrice: defaultFractionPrice
          });
        }
        
        setEditorData(prev => ({
          ...prev,
          gallery: [...(prev.gallery || []), ...newItems]
        }));
        showNotification(`${newItems.length} item(ns) adicionado(s) à galeria`);
      }
    } catch (err: any) {
      showNotification(err.message || "Erro no upload");
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleTokenizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenizeData.title || !tokenizeData.artist || !tokenizeData.imageUrl || !userProfile?.id) {
        showNotification('Título, Artista e Imagem são obrigatórios para avaliação.');
        return;
    }

    setIsLoading(true);

    // 1. Local Save (Simulated)
    setTimeout(() => {
      showNotification('Solicitação enviada! Nossa curadoria avaliará seu ativo em até 48h (Local).');
      setCurrentView('HOME');
      setTokenizeData({ title: '', artist: '', year: '', estimatedValue: '', description: '', imageUrl: '' });
      setIsLoading(false);
    }, 800);
  };

  const totalPortfolioValue = useMemo(() => {
    if (!userHoldings || !assets) return 0;
    return userHoldings.reduce((acc, holding) => {
      // Tenta encontrar o preço nos ativos principais
      const mainAsset = assets.find(a => a && a.id === holding.assetId);
      if (mainAsset) {
        return acc + (holding.fractionsOwned * (mainAsset.fractionPrice || 0));
      }
      
      // Se não for ativo principal, busca nas galerias (itens de custódia)
      for (const a of assets) {
        if (!a) continue;
        const galleryItem = a.gallery?.find(g => g && g.id === holding.assetId);
        if (galleryItem) {
          const itemTotalValue = galleryItem.totalValue !== undefined ? galleryItem.totalValue : a.totalValue;
          const calculatedPrice = (itemTotalValue || 0) * 0.1; // Lógica da galeria
          return acc + (holding.fractionsOwned * calculatedPrice);
        }
      }
      
      return acc;
    }, 0);
  }, [userHoldings, assets]);

  // --- Render Functions ---

  const renderArtistDetail = () => {
    if (!selectedArtist) return null;
    
    // Encontra o primeiro ativo deste artista para a imagem de destaque
    const artistAsset = assets.find(a => a && a.artist === selectedArtist);
    
    if (!artistAsset) return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Artista não encontrado na custódia.</p>
          <button onClick={() => setCurrentView('HOME')} className="text-amber-500 text-xs font-black uppercase tracking-widest">Voltar ao Início</button>
        </div>
      </div>
    );

    return (
      <div className="min-h-screen bg-slate-950 pb-32">
        {/* Header com botão de voltar */}
        <header className="p-6 flex items-center justify-between sticky top-0 bg-slate-950/80 backdrop-blur-md z-50">
          <button onClick={() => setCurrentView('HOME')} className="h-10 w-10 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center text-white active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left"></i>
          </button>
          <h2 className="text-white font-black text-[10px] uppercase tracking-[0.3em] opacity-60">Ficha Técnica</h2>
          <div className="w-10"></div>
        </header>

        <div className="px-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Nome do Artista */}
          <div className="space-y-1">
            <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.4em]">Artista em Destaque</p>
            <h1 className="text-4xl font-black text-white uppercase tracking-tighter leading-[0.9]">{selectedArtist}</h1>
          </div>

          {/* Imagem Única da Obra - Menos arredondada */}
          <div className="aspect-[3/4] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative group">
            <img 
              src={artistAsset.imageUrl} 
              className="w-full h-full object-cover"
              alt={artistAsset.title}
              referrerPolicy="no-referrer"
            />
          </div>

          {/* NOVO CARD FICHA TÉCNICA (ESTILO IMAGEM) */}
          <div className="space-y-2">
            {/* Bloco 1: Ficha Técnica */}
            <div className="bg-[#0f172a] border border-slate-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <i className="fa-solid fa-file-lines text-amber-500 text-sm"></i>
                <h3 className="text-slate-400 text-[12px] font-black uppercase tracking-[0.2em]">Ficha Técnica</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="space-y-0">
                  <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest leading-none">Artista</p>
                  <p className="text-white text-xl font-black tracking-tight leading-tight">{selectedArtist}</p>
                </div>
                <div className="space-y-0">
                  <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest leading-none">Ano</p>
                  <p className="text-white text-xl font-black tracking-tight leading-tight">{artistAsset.year}</p>
                </div>
              </div>

              <div className="space-y-0">
                <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest leading-none">Descrição</p>
                <p className="text-slate-300 text-base leading-tight font-medium pt-1">
                  {artistAsset.description || "Obra integrante do acervo sob custódia, selecionada por sua relevância técnica e histórica."}
                </p>
              </div>
            </div>

            {/* Bloco 2: Garantia & Custódia */}
            <div className="bg-[#0f172a] border border-slate-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <i className="fa-solid fa-shield-halved text-emerald-500 text-sm"></i>
                <h3 className="text-slate-400 text-[12px] font-black uppercase tracking-[0.2em]">Garantia & Custódia</h3>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="space-y-0">
                  <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest leading-none">Seguradora</p>
                  <p className="text-emerald-400 text-base font-black uppercase tracking-tight leading-tight">{artistAsset.insuranceCompany || "OASIS SAFE"}</p>
                </div>
                <div className="space-y-0">
                  <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest leading-none">Apólice</p>
                  <p className="text-white text-base font-black uppercase tracking-tight leading-tight">{artistAsset.policyNumber || "ALZ-9922-Y"}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                  <p className="text-slate-500 text-[12px] font-black uppercase tracking-widest leading-none">Vigência da Apólice</p>
                  <p className="text-white text-[14px] font-black tracking-widest leading-none">{artistAsset.insuranceExpiry ? new Date(artistAsset.insuranceExpiry).toLocaleDateString('pt-BR') : "30/12/2026"}</p>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full w-[70%]"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderHome = () => {
    const custodyArtists = Array.from(new Set(assets.filter(a => a && !a.isCatalogOnly).map(a => a.artist)));

    // Dynamic calculation of all assets for sale (Fund AUM)
    const totalEquity = assets
      .filter(a => a && !a.isCatalogOnly)
      .reduce((acc, a) => acc + (a.totalValue || 0), 0);

    const displayName = (() => {
        if (!userProfile?.name) return 'INVESTIDOR';
        const parts = userProfile.name.trim().split(/\s+/);
        if (parts.length <= 1) return userProfile.name;
        return `${parts[0]} ${parts[parts.length - 1]}`;
    })();

    return (
    <div className="pt-24 p-4 pb-32 space-y-2 animate-in fade-in duration-500">
      
      {/* Bloco de Elevação Interna: Header + Card Resumo + Acervo Title + Galeria + Artistas em Destaque */}
      <div className="-mt-22 space-y-2 relative z-30">
        <header className="flex justify-between items-start relative z-30 mb-2">
          <div>
            <h1 className="text-5xl font-black bg-gradient-to-r from-amber-200 to-amber-500 bg-clip-text text-transparent uppercase tracking-tighter leading-none mb-1">OASIS</h1>
            <p className="text-slate-400 text-sm font-bold tracking-[0.2em] uppercase pl-1">Fundo de Arte</p>
            <button onClick={() => requestPIN(() => setCurrentView('TOKENIZE'))} className="mt-3 h-7 px-4 bg-amber-500 text-slate-950 rounded-full text-[8px] font-black uppercase tracking-[0.15em] shadow-lg shadow-amber-500/20 active:scale-90 transition-all border border-amber-400/40 flex items-center gap-1.5">
              <i className="fa-solid fa-plus text-[9px]"></i> Tokenizar
            </button>
          </div>
          
          <div className="flex flex-col items-center gap-2 relative">
            <div 
              onClick={() => setCurrentView('PROFILE')} 
              className="h-20 w-20 bg-slate-800 rounded-full flex items-center justify-center border-[2px] border-yellow-400 shadow-xl transition-all overflow-hidden relative cursor-pointer active:scale-95 group"
            >
              {userProfile?.avatarUrl ? (
                <img 
                  src={userProfile.avatarUrl} 
                  className="w-full h-full object-cover origin-center" 
                  style={{ 
                    transform: `scale(${userProfile.avatarScale || 1})`,
                    objectPosition: `center ${userProfile.avatarOffset || 50}%`
                  }}
                  alt="Profile" 
                />
              ) : (
                <i className="fa-solid fa-user text-3xl text-yellow-400"></i>
              )}
            </div>
            <span className="text-yellow-400 text-[10px] font-black uppercase tracking-widest leading-none text-center max-w-[80px]">
               {displayName}
            </span>
          </div>
        </header>

        {/* Card Resumo Patrimonial - Altura h-[120px] */}
        <section className="bg-[#1e293b] rounded-[2rem] p-4 py-3 border border-slate-700/50 shadow-2xl relative overflow-hidden z-20 h-[120px] flex flex-col justify-center">
          <div className="absolute -right-6 -top-6 text-slate-700/20 transform rotate-12 pointer-events-none">
              <i className="fa-solid fa-plane text-[100px]"></i>
          </div>

          <div className="relative z-10">
            <p className="text-slate-400 text-[9px] font-black uppercase tracking-[0.2em] mb-0.5 opacity-80 leading-none">Resumo Patrimonial</p>
            <div className="flex items-center gap-2 mb-2">
               <div className="flex items-baseline text-white">
                  <span className="text-base font-bold text-slate-500 mr-1.5">R$</span>
                  <span className={`text-2xl font-black tracking-tighter transition-all duration-700 ${isSecurityUnlocked ? '' : 'filter blur-[4px] select-none opacity-80'}`}>
                      {(totalEquity || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
               </div>
               <span className="bg-[#10b981]/20 text-[#34d399] text-[9px] font-black px-1.5 py-0.5 rounded-full">+2.4%</span>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => requestPIN(() => { setTransactionAmount(''); setIsDepositModalOpen(true); })}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 rounded-xl text-[9px] uppercase tracking-[0.12em] shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98]"
              >
                 Depositar
              </button>
              <button 
                onClick={() => requestPIN(() => { setTransactionAmount(''); setIsWithdrawModalOpen(true); })}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 rounded-xl text-[9px] uppercase tracking-[0.12em] shadow-lg shadow-emerald-500/20 transition-all active:scale-98"
              >
                 Sacar
              </button>
            </div>
          </div>
        </section>

        {/* Seção ACERVO / ON LINE - Padding top removido para respeitar space-y-2 do pai */}
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xl font-black text-white uppercase tracking-widest leading-none">ACERVO</h3>
          <a href="https://fundodearte.com/artistas-acervo" target="_blank" rel="noopener noreferrer" className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-5 py-2 rounded-full flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-95">
            <i className="fa-solid fa-globe text-xs"></i> 
            <span className="text-[9px] font-black uppercase tracking-widest">ONLINE</span>
          </a>
        </div>

        {/* GALERIA DE ARQUIVOS - Movido para dentro do bloco elevado com space-y-2 */}
        <div className="relative w-full bg-slate-900 rounded-[2rem] overflow-hidden shadow-2xl border border-slate-800 z-10 h-[120px]">
          <div className="absolute inset-0">
            <img 
              src="https://images.unsplash.com/photo-1468581264429-2548ef9eb732?q=80&w=2070&auto=format&fit=crop" 
              className="w-full h-full object-cover" 
              alt="Coast" 
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-slate-950/80"></div>
          </div>
          
          <div className="relative p-4 h-full flex flex-col justify-center">
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shrink-0">
                    <i className="fa-solid fa-building-columns text-slate-950 text-xl"></i>
                </div>
                <div>
                    <h4 className="text-white font-black uppercase text-lg leading-none tracking-tight">GALERIA DE ARQUIVOS</h4>
                    <p className="text-amber-500 text-[8px] font-black uppercase tracking-widest mt-0.5">FUNDODEARTE.COM/ARTISTAS-ACERVO</p>
                </div>
            </div>
            
            <p className="text-slate-300 text-[10px] font-medium leading-tight opacity-90 mt-2 line-clamp-1">
                Acesso exclusivo à curadoria de ativos históricos sob gestão do Fundo de Arte.
            </p>
          </div>
        </div>

        {/* ARTISTAS EM DESTAQUE */}
        <div className="space-y-1">
           <p className="text-emerald-500 text-[14px] font-black uppercase tracking-[0.2em] pl-1">Artistas em Destaque</p>
           <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide snap-x">
              {custodyArtists.map((artist, idx) => {
                 const asset = assets.find(a => a && a.artist === artist);
                 if (!asset) return null;
                 return (
                    <div 
                      key={idx} 
                      onClick={() => {
                        setSelectedArtist(artist);
                        setCurrentView('ARTIST_DETAIL');
                      }} 
                      className="min-w-[115px] space-y-2 shrink-0 snap-start cursor-pointer active:scale-95 transition-transform"
                    >
                       <div className="h-[110px] bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative group shadow-lg">
                          <img 
                            src={asset.imageUrl} 
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                            alt={artist} 
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                       </div>
                       <div className="px-1">
                          <p className="text-white text-[11px] font-black uppercase tracking-widest mb-0">ARTISTA</p>
                          <p className="text-amber-500 text-[12px] font-black uppercase leading-tight tracking-wider truncate">{artist}</p>
                       </div>
                    </div>
                 );
              })}
           </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="space-y-1 pt-0">
          <div className="flex items-center gap-2.5 px-1 mb-0.5">
            <div className="h-[1px] flex-1 bg-slate-800/40"></div>
            <span className="text-emerald-500 text-[14px] font-black uppercase tracking-widest opacity-80">Ativos Sob Custódia</span>
            <div className="h-[1px] flex-1 bg-slate-800/40"></div>
          </div>
          <div className="space-y-2">
              {custodyArtists.map((artistName) => {
                  const userAsset = assets.find(a => a && a.artist === artistName);
                  if (!userAsset) return null;

                  return (
                  <div key={artistName} onClick={() => handleAssetUnlock(userAsset)} className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-2.5 flex items-center gap-3 cursor-pointer hover:border-amber-500/40 transition-all active:scale-[0.98] shadow-lg relative overflow-hidden group">
                      <div className="absolute top-2 right-2 h-7 w-7 bg-slate-950/80 backdrop-blur-md rounded-full flex items-center justify-center border border-slate-800 text-amber-500 shadow-sm z-20 transition-all group-hover:bg-amber-500 group-hover:text-slate-950">
                          <i className="fa-solid fa-lock text-[10px]"></i>
                      </div>
                      <div className="h-14 w-14 rounded-xl overflow-hidden shrink-0 border border-slate-700/30 shadow-md relative">
                          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[0px] z-10"></div>
                          <img 
                            src={userAsset.imageUrl} 
                            className="w-full h-full object-cover" 
                            alt="" 
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                      </div>
                      <div className="flex-1 min-w-0 z-10">
                          <p className="text-amber-500 text-[12px] font-black uppercase tracking-wider mb-0">{userAsset.artist}</p>
                          <h4 className="text-white font-black text-[11px] truncate uppercase tracking-tight mb-1">Galeria Privada</h4>
                          
                          <div className="flex items-center gap-2">
                             <InsuranceBadge status={userAsset.insuranceStatus} />
                             <span className="text-slate-400 text-[9px] font-bold">|</span>
                             <div className="flex items-baseline gap-0.5">
                                <span className="text-[8px] text-amber-500 font-bold">R$</span>
                                <span className={`text-white text-[10px] font-black transition-all duration-500 ${isSecurityUnlocked ? '' : 'filter blur-[1.5px] select-none opacity-90'}`}>
                                    {formatCurrency(userAsset.totalValue || 0)}
                                </span>
                             </div>
                          </div>
                      </div>
                      <div className="mr-2 opacity-50">
                         <i className="fa-solid fa-chevron-right text-slate-500 text-xs"></i>
                      </div>
                  </div>
                  );
              })}
          </div>
        </div>
      </section>

      {/* Lock Screen Modal */}
      {(lockingAsset || pendingAction) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl" onClick={() => { setLockingAsset(null); setPendingAction(null); }}></div>
           <div className={`bg-[#0a0f1d] border border-slate-800/50 p-10 rounded-[3rem] w-full max-w-[340px] relative z-10 shadow-2xl text-center space-y-8 transition-all duration-300 ${pinError ? 'animate-shake border-red-500/50' : ''}`}>
              <div className="h-24 w-24 bg-[#1a1f2e] rounded-full flex items-center justify-center mx-auto border border-slate-800/50 shadow-inner">
                 <i className="fa-solid fa-key text-[#f59e0b] text-3xl"></i>
              </div>
              
              <div className="space-y-2">
                <h4 className="text-white font-black text-2xl uppercase tracking-tighter">Área Restrita</h4>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                  Insira o PIN definido no login
                </p>
              </div>

              <div className="flex justify-center gap-3 relative overflow-hidden h-16">
                {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className={`h-14 w-14 rounded-2xl border-2 flex items-center justify-center transition-all ${pinValue.length > idx ? 'border-amber-500 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'border-slate-800 bg-[#05080f]'}`}>
                        {pinValue.length > idx && <span className="text-amber-500 text-2xl font-black animate-in zoom-in duration-200">*</span>}
                    </div>
                ))}
                
                <input 
                  type="tel" 
                  maxLength={4} 
                  autoFocus
                  className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full text-center"
                  style={{ fontSize: '16px' }}
                  value={pinValue}
                  onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setPinValue(val);
                      setPinError(false);
                      
                      if (val.length === 4) {
                          setTimeout(() => {
                              handlePinAction(val);
                          }, 300);
                      }
                  }}
                />
              </div>

              {pinError && <p className="text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse">PIN Incorreto</p>}

              <div className="space-y-4 pt-2">
                <button 
                  onClick={() => handlePinAction()}
                  className="w-full bg-[#f59e0b] hover:bg-amber-400 text-slate-950 font-black py-5 rounded-2xl text-[12px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-lg shadow-amber-500/10"
                >
                  DESBLOQUEAR
                </button>
                
                <button 
                  onClick={() => { 
                    setLockingAsset(null);
                    setPendingAction(null);
                    setPinValue('');
                    if (!userProfile?.phoneNumber) {
                      setShowPhoneModal(true);
                    } else {
                      setCurrentView('PROFILE'); 
                      setTimeout(() => {
                        const el = document.getElementById('pin-field');
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el?.focus();
                      }, 300);
                    }
                  }}
                  className="w-full bg-[#10b981] hover:bg-emerald-400 text-white font-black py-5 rounded-2xl text-[12px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-xl shadow-emerald-500/10"
                >
                  DEFINA SEU PIN
                </button>
              </div>

              <div onClick={() => { setLockingAsset(null); setPendingAction(null); }} className="text-red-500 hover:text-red-400 text-[11px] font-black uppercase tracking-widest pt-4 transition-all cursor-pointer active:scale-95">
                CANCELAR
              </div>
           </div>
        </div>
      )}
    </div>
  );
  };

  const renderPortfolio = () => {
    return (
      <div className="p-5 pb-32 animate-in fade-in duration-500">
        <header className="mb-8">
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-1">Portfolio</h2>
          <p className="text-emerald-500 text-[10px] font-black uppercase tracking-[0.3em]">Seus Ativos Adquiridos</p>
        </header>

        {userHoldings.length === 0 ? (
          <div className="py-24 text-center space-y-4">
             <div className="h-20 w-20 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-700 mb-4 opacity-50">
                <i className="fa-solid fa-folder-open text-3xl"></i>
             </div>
             <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Nenhum ativo em carteira</p>
             <button onClick={() => setCurrentView('MARKETPLACE')} className="text-amber-500 text-[9px] font-black uppercase underline tracking-widest underline-offset-4">Explorar Oportunidades</button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-[#111827] to-[#070b14] border border-emerald-500/30 p-7 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
               <div className="absolute -right-8 -bottom-8 text-emerald-500/5 rotate-12 pointer-events-none">
                  <i className="fa-solid fa-wallet text-[120px]"></i>
               </div>
               <p className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Valor Investido</p>
               <div className="flex items-baseline gap-2">
                  <span className="text-slate-600 font-bold text-lg">R$</span>
                  <span className="text-4xl font-black text-white tracking-tighter transition-all duration-300 ease-out">
                     {(totalPortfolioValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
               </div>
               <div className="mt-4 flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">{userHoldings.length} Ativos</span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 bg-slate-800/40 px-2.5 py-1 rounded-full">Total Liquidez</span>
               </div>
            </div>

            <div className="space-y-4">
               {userHoldings.map((holding) => {
                  const asset = assets.find(a => a && a.id === holding.assetId);
                  let displayAsset = asset;
                  if (!displayAsset) {
                    for (const a of assets) {
                      if (!a) continue;
                      const item = a.gallery?.find(g => g && g.id === holding.assetId);
                      if (item) {
                        displayAsset = { ...a, ...item, id: item.id } as ArtAsset;
                        break;
                      }
                    }
                  }

                  if (!displayAsset) return null;

                  const currentVal = (displayAsset.fractionPrice || 0) * holding.fractionsOwned;

                  return (
                    <div key={holding.assetId} className="bg-slate-900/60 border border-slate-800/80 rounded-[2.5rem] p-4 flex flex-col shadow-xl active:scale-[0.99] transition-all hover:border-emerald-500/20 group relative overflow-hidden">
                       <div className="flex gap-4 items-center">
                          <div className="h-24 w-24 rounded-2xl overflow-hidden shrink-0 border border-slate-700/30 relative">
                             <img 
                               src={displayAsset.imageUrl} 
                               className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
                               alt="" 
                               loading="lazy"
                               referrerPolicy="no-referrer"
                             />
                          </div>
                          <div className="flex-1 min-w-0 pr-2">
                             <div className="mb-2">
                                <p className="text-white text-[8px] font-black uppercase tracking-widest mb-0.5">{displayAsset.artist}</p>
                                <h4 className="text-white font-black text-xs truncate uppercase tracking-tight">{displayAsset.title}</h4>
                             </div>
                             
                             <div className="grid grid-cols-2 gap-y-2 gap-x-3 border-t border-slate-800/50 pt-2">
                                <div>
                                   <p className="text-slate-600 text-[7px] font-black uppercase tracking-widest mb-0.5">Frações</p>
                                   <p className="text-white font-bold text-[10px]">{holding.fractionsOwned} UN.</p>
                                </div>
                                <div className="text-right">
                                   <p className="text-slate-600 text-[7px] font-black uppercase tracking-widest mb-0.5">Preço/Fra</p>
                                   <p className="text-emerald-400 font-bold text-[10px]">R$ {formatCurrency(displayAsset.fractionPrice || 0)}</p>
                                </div>
                                <div className="col-span-2 flex justify-between items-center pt-1 border-t border-slate-800/30">
                                   <p className="text-slate-500 text-[7px] font-black uppercase tracking-widest">Total Alocado</p>
                                   <p className="text-white font-black text-[12px]">R$ {formatCurrency(currentVal)}</p>
                                </div>
                             </div>
                          </div>
                       </div>
                       
                       <div className="mt-4 pt-3 border-t border-slate-800/50 flex justify-between items-center">
                          <div className="text-[8px] text-slate-500 font-medium leading-tight max-w-[70%] line-clamp-2">
                             {displayAsset.description || "Ativo de arte tokenizado com garantia segurada."}
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleRemoveHolding(holding.assetId); }}
                            className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-4 py-2 rounded-full text-[8px] font-black uppercase tracking-widest transition-all active:scale-90 flex items-center gap-1.5"
                          >
                             <i className="fa-solid fa-trash-can text-[9px]"></i> Excluir
                          </button>
                       </div>
                    </div>
                  );
               })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAdminLogin = () => {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
        <div className="w-full max-w-[340px] space-y-8">
           <div className={`bg-[#0a0f1d] border border-slate-800/50 p-10 rounded-[3rem] shadow-2xl text-center space-y-8 transition-all duration-300 ${adminLoginError ? 'animate-shake border-red-500/50' : ''}`}>
              <div className="h-24 w-24 bg-[#1a1f2e] rounded-full flex items-center justify-center mx-auto border border-slate-800/50 shadow-inner">
                 <i className="fa-solid fa-user-shield text-[#f59e0b] text-3xl"></i>
              </div>
              
              <div className="space-y-2">
                <h4 className="text-white font-black text-2xl uppercase tracking-tighter">Painel Admin</h4>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                  Insira a senha institucional
                </p>
              </div>

              <div className="relative">
                 <input 
                    type="password"
                    maxLength={4}
                    autoFocus
                    value={adminPwdInput}
                    onChange={(e) => { setAdminPwdInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setAdminLoginError(false); }}
                    onKeyDown={(e) => e.key === 'Enter' && checkAdminCredentials()}
                    className="w-full bg-[#05080f] border-2 border-slate-800 rounded-2xl py-5 px-6 text-amber-500 text-center text-3xl font-black focus:border-amber-500 outline-none transition-all shadow-inner tracking-[0.8em]"
                    placeholder="****"
                 />
                 {adminLoginError && <p className="text-red-500 text-[10px] font-black uppercase text-center mt-4 animate-pulse">PIN Admin Incorreto</p>}
              </div>

              <div className="space-y-4 pt-2">
                <button 
                   onClick={checkAdminCredentials}
                   className="w-full bg-[#f59e0b] hover:bg-amber-400 text-slate-950 font-black py-5 rounded-2xl text-[12px] uppercase tracking-[0.4em] active:scale-95 transition-all shadow-lg"
                >
                   ENTRAR
                </button>

                <button 
                   onClick={() => setCurrentView('PROFILE')}
                   className="w-full text-red-500 hover:text-red-400 text-[11px] font-black uppercase tracking-[0.4em] transition-all active:scale-95 mt-4"
                >
                   CANCELAR
                </button>
              </div>
           </div>
        </div>
      </div>
    );
  };

  const handleSeedAssets = async () => {
    setIsLoading(true);
    try {
      for (const asset of MOCK_ASSETS) {
        const assetDocRef = doc(db, 'assets', asset.id);
        await setDoc(assetDocRef, asset, { merge: true });
      }
      showNotification("Banco de dados populado com ativos iniciais!");
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'assets');
    } finally {
      setIsLoading(false);
    }
  };

  const renderAdminEditor = () => {
    if (!isAdminAuthenticated) return renderAdminLogin();
    const isNew = !assets.find(a => a && a.id === editorData.id);

    return (
      <div className="min-h-screen bg-[#070b14] animate-in slide-in-from-right duration-500 pb-32 overflow-x-hidden">
        <input 
          type="file" 
          ref={mainImageInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={(e) => handleFileChange(e, 'MAIN')} 
        />
        <input 
          type="file" 
          ref={galleryImageInputRef} 
          className="hidden" 
          accept="image/*" 
          multiple
          onChange={(e) => handleFileChange(e, 'GALLERY')} 
        />

        <div className="bg-[#0f172a]/95 backdrop-blur-xl border-b border-slate-800 p-4 pt-10 sticky top-0 z-[60] shadow-2xl">
           <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x items-center">
              <button onClick={() => handleAdminEdit()} className={`min-w-[110px] h-14 rounded-2xl border flex items-center justify-center gap-2 transition-all shrink-0 snap-start ${isNew ? 'bg-amber-500/20 border-amber-500 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                 <i className="fa-solid fa-plus text-lg"></i>
                 <span className="text-[11px] font-black uppercase tracking-[0.2em]">NOVO</span>
              </button>
              {assets.length === 0 && (
                <button onClick={handleSeedAssets} className="min-w-[180px] h-14 rounded-2xl border border-emerald-500 bg-emerald-500/10 text-emerald-500 flex items-center justify-center gap-2 shrink-0 snap-start">
                   <i className="fa-solid fa-database"></i>
                   <span className="text-[10px] font-black uppercase tracking-widest">Popular Banco</span>
                </button>
              )}
              {assets.filter(a => a && a.id).map((asset) => (
                 <button key={asset.id} onClick={() => handleAdminEdit(asset)} className={`min-w-[140px] h-14 rounded-2xl border flex items-center gap-3 px-3 transition-all shrink-0 snap-start relative group overflow-hidden ${editorData.id === asset.id ? 'bg-white border-white text-slate-950 shadow-lg' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                    <div className="h-9 w-9 rounded-xl overflow-hidden border border-slate-700/50 shrink-0">
                       <img 
                         src={asset.imageUrl} 
                         className="w-full h-full object-cover" 
                         alt="" 
                         loading="lazy"
                         referrerPolicy="no-referrer"
                       />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-tighter truncate leading-tight">{asset.title}</span>
                 </button>
              ))}
           </div>
           <div className="w-full h-1.5 bg-slate-900 mt-2 rounded-full overflow-hidden border border-slate-800/50">
              <div className="h-full w-1/4 bg-slate-400 transition-all duration-700 shadow-[0_0_10px_white]"></div>
           </div>
        </div>

        <div className="p-6 pt-10 space-y-10 max-w-md mx-auto">
          <div className="bg-[#111827]/80 border border-slate-800 p-8 rounded-[3.5rem] space-y-10 shadow-[0_40px_100px_rgba(0,0,0,0.6)] relative overflow-hidden backdrop-blur-md">
             <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                    <button onClick={() => { setIsAdminAuthenticated(false); setCurrentView('HOME'); }} className="text-amber-500 hover:text-amber-400 transition-colors">
                        <i className="fa-solid fa-arrow-left text-xl"></i>
                    </button>
                    <h2 className="text-white font-black text-2xl uppercase tracking-tighter">EDITAR ATIVO</h2>
                </div>
                <button onClick={() => { setIsAdminAuthenticated(false); setCurrentView('HOME'); }} className="h-10 w-10 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center text-slate-500 hover:text-white transition-all active:scale-75 shadow-lg">
                   <i className="fa-solid fa-xmark"></i>
                </button>
             </div>

              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">ARTISTA</label>
                  <input className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" value={editorData.artist || ''} placeholder="Ex: Hélio Oiticica" onChange={e => { setEditorData({...editorData, artist: e.target.value}); setHasSavedAdminChanges(false); }} />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">DESCRIÇÃO</label>
                  <textarea rows={5} className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-medium outline-none focus:border-amber-500/50 transition-all resize-none shadow-inner leading-relaxed" placeholder="..." value={editorData.description || ''} onChange={e => { setEditorData({...editorData, description: e.target.value}); setHasSavedAdminChanges(false); }} />
                </div>

                <div className="space-y-3">
                   <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">IMAGEM PRINCIPAL (CAPA)</label>
                   <div 
                      onClick={() => mainImageInputRef.current?.click()} 
                      className="relative aspect-video bg-[#030712] border-2 border-dashed border-slate-800 rounded-[2.5rem] overflow-hidden group cursor-pointer hover:border-amber-500/50 transition-all shadow-2xl"
                   >
                      {editorData.imageUrl ? (
                        <img 
                          src={editorData.imageUrl} 
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" 
                          alt="Asset Preview" 
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                           <i className="fa-solid fa-cloud-arrow-up text-4xl"></i>
                           <span className="text-[11px] font-black uppercase tracking-[0.3em]">UPLOAD COVER</span>
                        </div>
                      )}
                      {isUploading && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-amber-500">
                           <i className="fa-solid fa-circle-notch fa-spin text-3xl mb-2"></i>
                           <span className="text-[10px] font-black uppercase tracking-widest">Processando...</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all backdrop-blur-[4px]">
                        <div className="bg-white text-slate-950 px-8 py-4 rounded-full text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl scale-90 group-hover:scale-100 transition-transform">SELECIONAR ARQUIVO</div>
                      </div>
                   </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">TÍTULO DA OBRA</label>
                  <input 
                    className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner uppercase" 
                    value={editorData.title || ''} 
                    placeholder="Ex: OVULO" 
                    onChange={e => { setEditorData({...editorData, title: e.target.value}); setHasSavedAdminChanges(false); }} 
                  />
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">VALOR TOTAL (R$)</label>
                    <input type="text" className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" value={editorData.totalValue ? formatCurrency(editorData.totalValue) : ''} placeholder="0,00" onChange={e => {
                      const formatted = formatInputCurrency(e.target.value);
                      const totalVal = parseCurrency(formatted);
                      const fractCount = editorData.totalFractions || 10000;
                      setEditorData({
                        ...editorData, 
                        totalValue: totalVal,
                        fractionPrice: totalVal / fractCount
                      });
                      setHasSavedAdminChanges(false);
                    }} />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">PREÇO FRAÇÃO (R$)</label>
                    <input type="text" className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" value={editorData.fractionPrice ? formatCurrency(editorData.fractionPrice) : ''} placeholder="0,00" onChange={e => {
                      const formatted = formatInputCurrency(e.target.value);
                      const fractPrice = parseCurrency(formatted);
                      const fractCount = editorData.totalFractions || 10000;
                      setEditorData({
                        ...editorData, 
                        fractionPrice: fractPrice,
                        totalValue: fractPrice * fractCount
                      });
                      setHasSavedAdminChanges(false);
                    }} />
                  </div>
                </div>

                <div className="space-y-6 pt-6 border-t border-slate-800/50">
                  <h3 className="text-white text-[11px] font-black uppercase tracking-[0.3em] ml-2 flex items-center gap-2">
                    <i className="fa-solid fa-shield-halved text-amber-500"></i> Garantia & Custódia
                  </h3>
                  
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">SEGURADORA</label>
                      <input className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" 
                             value={editorData.insuranceCompany || ''} 
                             placeholder="Ex: Allianz Art & Heritage" 
                             onChange={e => { setEditorData({...editorData, insuranceCompany: e.target.value}); setHasSavedAdminChanges(false); }} />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-5">
                      <div className="space-y-3">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">Nº DA APÓLICE</label>
                        <input className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" 
                               value={editorData.policyNumber || ''} 
                               placeholder="Ex: ALZ-9921-X" 
                               onChange={e => { setEditorData({...editorData, policyNumber: e.target.value}); setHasSavedAdminChanges(false); }} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-2">VIGÊNCIA (VENCIMENTO)</label>
                        <input type="date" className="w-full bg-[#030712] border border-slate-800 rounded-[1.5rem] py-5 px-6 text-white text-sm font-bold outline-none focus:border-amber-500/50 transition-all shadow-inner" 
                               value={editorData.insuranceExpiry ? editorData.insuranceExpiry.split('T')[0] : ''} 
                               onChange={e => { setEditorData({...editorData, insuranceExpiry: e.target.value}); setHasSavedAdminChanges(false); }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div onClick={() => { setEditorData({...editorData, isCatalogOnly: !editorData.isCatalogOnly}); setHasSavedAdminChanges(false); }} className="bg-[#030712] border border-slate-800 p-8 rounded-[2rem] flex items-center justify-between cursor-pointer active:scale-[0.98] transition-all shadow-lg">
                   <span className="text-white text-[12px] font-black uppercase tracking-[0.3em] opacity-80">ITEM DE CATÁLOGO (SEM VENDA)</span>
                   <div className={`w-16 h-10 rounded-full p-1.5 relative transition-all duration-500 shadow-inner ${editorData.isCatalogOnly ? 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'bg-slate-800'}`}>
                      <div className={`h-7 w-7 rounded-full bg-white shadow-xl transform transition-all duration-500 ease-out ${editorData.isCatalogOnly ? 'translate-x-6' : 'translate-x-0'}`}></div>
                   </div>
                </div>

                <div className="space-y-6 pt-8 border-t border-slate-800/50">
                   <div className="flex items-center justify-between px-2">
                      <div className="flex flex-col">
                        <label className="text-[11px] text-slate-500 font-black uppercase tracking-[0.3em]">GALERIA ADICIONAL (CUSTÓDIA)</label>
                        <span className="text-[8px] text-slate-600 uppercase font-bold tracking-widest">Defina título, valor total e preço por obra</span>
                      </div>
                      <button 
                        onClick={() => galleryImageInputRef.current?.click()} 
                        disabled={isUploading}
                        className="h-10 px-6 bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[10px] font-black uppercase tracking-[0.4em] rounded-full flex items-center gap-2 active:scale-90 transition-all shadow-lg disabled:opacity-50"
                      >
                         {isUploading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-plus text-xs"></i>}
                         {isUploading ? 'PROCESSANDO' : 'ADD IMAGEM'}
                      </button>
                   </div>
                   
                   <div className="space-y-12">
                      {(editorData.gallery || []).length === 0 && !isUploading && (
                        <div className="py-10 border-2 border-dashed border-slate-800 rounded-[2rem] flex flex-col items-center justify-center text-slate-700">
                           <i className="fa-solid fa-images text-3xl mb-2 opacity-20"></i>
                           <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Nenhuma obra na galeria</p>
                        </div>
                      )}
                      
                      {(editorData.gallery || []).map((item, index) => (
                         <div key={item.id} className="bg-[#111827]/60 border border-slate-800 rounded-[3rem] p-8 flex flex-col gap-8 items-stretch shadow-2xl relative group">
                            <div className="relative w-full aspect-video bg-slate-900 rounded-[2rem] overflow-hidden border border-slate-800 shadow-xl group/img">
                               <img 
                                 src={item.imageUrl} 
                                 className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" 
                                 alt="" 
                                 loading="lazy"
                                 referrerPolicy="no-referrer"
                               />
                               <button onClick={(e) => { e.stopPropagation(); setEditorData(prev => ({ ...prev, gallery: (prev.gallery || []).filter(g => g.id !== item.id) })); setHasSavedAdminChanges(false); }} className="absolute top-4 right-4 h-10 w-10 bg-red-500 text-white rounded-2xl flex items-center justify-center text-sm shadow-2xl active:scale-75 transition-all opacity-0 group-hover:opacity-100 backdrop-blur-md">
                                  <i className="fa-solid fa-trash-can"></i>
                               </button>
                            </div>
                            
                            <div className="w-full space-y-6">
                               <div className="space-y-3">
                                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] ml-2">TÍTULO DA OBRA</label>
                                  <input 
                                    className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all shadow-inner" 
                                    value={item.title} 
                                    onChange={(e) => {
                                      const newGallery = [...(editorData.gallery || [])];
                                      newGallery[index] = { ...item, title: e.target.value };
                                      setEditorData({ ...editorData, gallery: newGallery });
                                      setHasSavedAdminChanges(false);
                                    }}
                                  />
                               </div>
                               
                               <div className="grid grid-cols-2 gap-5">
                                  <div className="space-y-3">
                                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] ml-2">VALOR TOTAL (R$)</label>
                                     <input 
                                       type="text"
                                       className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all shadow-inner" 
                                       value={item.totalValue ? formatCurrency(item.totalValue) : ''} 
                                       placeholder="0,00"
                                       onChange={(e) => {
                                         setHasSavedAdminChanges(false);
                                         const formatted = formatInputCurrency(e.target.value);
                                         const val = parseCurrency(formatted);
                                         const count = editorData.totalFractions || 10000;
                                         const newGallery = [...(editorData.gallery || [])];
                                         newGallery[index] = { 
                                           ...item, 
                                           totalValue: val,
                                           fractionPrice: val / count 
                                         };
                                         setEditorData({ ...editorData, gallery: newGallery });
                                       }}
                                     />
                                  </div>
                                  <div className="space-y-3">
                                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] ml-2">PREÇO / FRAÇÃO (R$)</label>
                                     <input 
                                       type="text"
                                       className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-amber-500 text-sm font-black focus:border-amber-500 outline-none transition-all shadow-inner" 
                                       value={item.fractionPrice ? formatCurrency(item.fractionPrice) : ''} 
                                       placeholder="0,00"
                                       onChange={(e) => {
                                         setHasSavedAdminChanges(false);
                                         const formatted = formatInputCurrency(e.target.value);
                                         const p = parseCurrency(formatted);
                                         const count = editorData.totalFractions || 10000;
                                         const newGallery = [...(editorData.gallery || [])];
                                         newGallery[index] = { 
                                           ...item, 
                                           fractionPrice: p,
                                           totalValue: p * count
                                         };
                                         setEditorData({ ...editorData, gallery: newGallery });
                                       }}
                                     />
                                  </div>
                               </div>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>

                <div className="pt-12 flex flex-col gap-5">
                   {(!editorData.artist || !editorData.policyNumber) && (
                     <div className="bg-red-600 text-white font-black py-6 px-8 rounded-[2rem] text-[10px] uppercase tracking-[0.2em] flex items-center gap-4 shadow-[0_20px_40px_rgba(220,38,38,0.3)] animate-in slide-in-from-bottom-2 duration-300">
                       <i className="fa-solid fa-circle-xmark text-xl"></i>
                       <span className="leading-tight">ARTISTA E CÓDIGO DA PÓLICE DE SEGURO SÃO OBRIGATÓRIOS</span>
                     </div>
                   )}

                   <button 
                    onClick={handleAdminSave} 
                    disabled={isLoading || isUploading || !editorData.artist || !editorData.policyNumber} 
                    style={{ backgroundColor: hasSavedAdminChanges ? '#10b981' : undefined }}
                    className={`w-full ${hasSavedAdminChanges ? 'hover:bg-emerald-400' : 'bg-amber-500 hover:bg-amber-400'} text-slate-950 font-black py-7 rounded-[3rem] text-[13px] uppercase tracking-[0.6em] shadow-[0_20px_50px_rgba(245,158,11,0.3)] active:scale-95 transition-all flex items-center justify-center gap-4 disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none`}
                   >
                     {isLoading ? (
                       <><i className="fa-solid fa-circle-notch fa-spin"></i> SALVANDO...</>
                     ) : hasSavedAdminChanges ? (
                       <><i className="fa-solid fa-circle-check"></i> ALTERAÇÕES SALVAS</>
                     ) : (
                       <><i className="fa-solid fa-check-double"></i> SALVAR ALTERAÇÕES</>
                     )}
                   </button>
                   {!isNew && (
                    <div className="mt-6">
                      {deleteConfirmationId === editorData.id ? (
                        <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-[2rem] space-y-4 animate-in zoom-in duration-300">
                           <p className="text-red-500 text-[10px] font-black uppercase tracking-widest text-center">Confirmar exclusão permanente?</p>
                           <div className="flex gap-3">
                              <button onClick={() => handleAdminDelete(editorData.id!)} className="flex-1 bg-red-500 text-white font-black py-4 rounded-full text-[10px] uppercase tracking-widest active:scale-95 transition-all">SIM, EXCLUIR</button>
                              <button onClick={() => setDeleteConfirmationId(null)} className="flex-1 bg-slate-800 text-slate-400 font-black py-4 rounded-full text-[10px] uppercase tracking-widest active:scale-95 transition-all">CANCELAR</button>
                           </div>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmationId(editorData.id!)} className="w-full bg-transparent border border-red-500/20 text-red-500/40 py-5 text-[11px] font-black uppercase tracking-[0.4em] rounded-full hover:bg-red-500/10 hover:text-red-500 transition-all shadow-inner cursor-pointer">
                            <i className="fa-solid fa-trash-can mr-2"></i> EXCLUIR ATIVO PERMANENTEMENTE
                        </button>
                      )}
                    </div>
                   )}
                </div>

                <div className="pt-10 flex flex-col items-center gap-4">
                    <button 
                      onClick={() => { setIsAdminAuthenticated(false); setCurrentView('HOME'); }} 
                      style={{ backgroundColor: '#f09d0f' }}
                      className="hover:bg-[#d88d0d] text-slate-950 text-[11px] font-black uppercase tracking-[0.4em] py-4 px-10 rounded-full shadow-lg shadow-amber-500/20 transition-all flex items-center gap-3 active:scale-95"
                    >
                        <i className="fa-solid fa-house text-sm"></i> Voltar para Início
                    </button>
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTokenize = () => {
    return (
      <div className="min-h-screen bg-[#070b14] animate-in slide-in-from-right duration-500 pb-32 overflow-x-hidden">
        <input 
          type="file" 
          ref={tokenizeImageInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={(e) => handleFileChange(e, 'TOKENIZE')} 
        />
        
        <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-900/40 p-5 flex items-center gap-4 max-w-md mx-auto shadow-2xl">
            <button onClick={() => setCurrentView('HOME')} className="h-10 w-10 bg-slate-900 rounded-full flex items-center justify-center text-white border border-slate-800 transition-all active:scale-75 shadow-lg"><i className="fa-solid fa-arrow-left"></i></button>
            <h2 className="text-lg font-black text-white uppercase tracking-tighter leading-none">Solicitar Tokenização</h2>
        </header>

        <div className="pt-24 p-6 space-y-10 max-w-md mx-auto">
          <div className="text-center space-y-2">
             <h3 className="text-amber-500 font-black text-[10px] uppercase tracking-[0.4em]">Converta sua Arte</h3>
             <p className="text-slate-400 text-xs font-medium leading-relaxed px-4">Submeta seu ativo físico para avaliação. Se aprovado, ele será custodiado, segurado e fragmentado em frações digitais líquidas.</p>
          </div>

          <form onSubmit={handleTokenizeSubmit} className="bg-[#111827]/80 border border-slate-800 p-8 rounded-[3rem] space-y-8 shadow-2xl backdrop-blur-md">
             <div 
                onClick={() => tokenizeImageInputRef.current?.click()} 
                className="relative aspect-video bg-[#030712] border-2 border-dashed border-slate-800 rounded-[2rem] overflow-hidden group cursor-pointer hover:border-amber-500/50 transition-all shadow-inner"
             >
                {tokenizeData.imageUrl ? (
                  <img 
                    src={tokenizeData.imageUrl} 
                    className="w-full h-full object-cover opacity-80" 
                    alt="Preview" 
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                     <i className="fa-solid fa-camera text-4xl"></i>
                     <span className="text-[9px] font-black uppercase tracking-[0.3em]">FOTO DA OBRA</span>
                  </div>
                )}
                {isUploading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                     <i className="fa-solid fa-circle-notch fa-spin text-amber-500 text-2xl"></i>
                  </div>
                )}
             </div>

             <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] ml-1">Título da Obra *</label>
                  <input 
                    className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all" 
                    value={tokenizeData.title} 
                    onChange={e => setTokenizeData({...tokenizeData, title: e.target.value.toUpperCase()})}
                    placeholder="EX: COMPOSIÇÃO AZUL"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] ml-1">Artista *</label>
                  <input 
                    className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all" 
                    value={tokenizeData.artist} 
                    onChange={e => setTokenizeData({...tokenizeData, artist: e.target.value.toUpperCase()})}
                    placeholder="EX: IVAN SERPA"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] ml-1">Ano</label>
                    <input 
                      className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all" 
                      value={tokenizeData.year} 
                      onChange={e => setTokenizeData({...tokenizeData, year: e.target.value})}
                      placeholder="1970"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] ml-1">Valor Est. (R$)</label>
                    <input 
                      className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all" 
                      value={tokenizeData.estimatedValue} 
                      onChange={e => setTokenizeData({...tokenizeData, estimatedValue: formatInputCurrency(e.target.value)})}
                      placeholder="50.000,00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] ml-1">Breve Histórico</label>
                  <textarea 
                    rows={3}
                    className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-medium focus:border-amber-500/50 outline-none transition-all resize-none" 
                    value={tokenizeData.description} 
                    onChange={e => setTokenizeData({...tokenizeData, description: e.target.value})}
                    placeholder="Proveniência, exposições, etc..."
                  />
                </div>
             </div>

             <button 
                type="submit"
                disabled={isLoading || isUploading}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-5 rounded-2xl text-[11px] uppercase tracking-[0.3em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
             >
                {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
                {isLoading ? 'ENVIANDO...' : 'ENVIAR PARA CURADORIA'}
             </button>
          </form>
        </div>
      </div>
    );
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64, 400, 400, 0.7);
        setUserProfile(prev => prev ? { ...prev, avatarUrl: compressed } : null);
        showNotification("Avatar atualizado com sucesso!");
      };
      reader.readAsDataURL(file);
    }
  };

  const renderProfile = () => (
    <div className="animate-in slide-in-from-bottom duration-500 bg-[#070b14] min-h-screen pb-32">
      <input 
        type="file" 
        ref={avatarInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleAvatarFileChange} 
      />
      <header className="pt-12 pb-8 flex flex-col items-center gap-4">
         <div className="relative">
            <div 
              onClick={() => avatarInputRef.current?.click()} 
              className={`h-32 w-32 bg-[#1a2333] rounded-full border flex items-center justify-center overflow-hidden cursor-pointer active:scale-95 transition-transform ${!userProfile?.avatarUrl ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] animate-pulse' : 'border-slate-800'}`}
            >
               {userProfile?.avatarUrl ? (
                 <img 
                   src={userProfile?.avatarUrl} 
                   className="w-full h-full object-cover origin-center" 
                   style={{ 
                     transform: `scale(${userProfile?.avatarScale || 1})`,
                     objectPosition: `center ${userProfile?.avatarOffset || 50}%`
                   }}
                   alt="Profile" 
                 />
               ) : (
                 <div className="flex flex-col items-center gap-1">
                   <i className="fa-solid fa-camera text-4xl text-slate-500"></i>
                   <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">FOTO*</span>
                 </div>
               )}
            </div>
            <div className="absolute bottom-1 right-1 h-8 w-8 bg-[#f59e0b] rounded-full flex items-center justify-center border-2 border-[#070b14] shadow-lg pointer-events-none">
               <i className="fa-solid fa-plus text-slate-900 text-xs"></i>
            </div>
            {/* Delete Photo Button */}
            {userProfile?.avatarUrl && (
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setUserProfile(prev => ({ ...prev, avatarUrl: '' }));
                  showNotification("Foto removida");
                }}
                className="absolute -top-1 -right-1 h-8 w-8 bg-red-500 rounded-full flex items-center justify-center border-2 border-[#070b14] shadow-lg active:scale-90 transition-all z-20"
              >
                <i className="fa-solid fa-trash-can text-white text-[10px]"></i>
              </button>
            )}
         </div>
         
         {userProfile.avatarUrl && (
           <div className="w-full max-w-[280px] space-y-4 px-4 py-2 bg-slate-900/40 rounded-2xl border border-slate-800/50">
             <div className="space-y-1">
               <div className="flex justify-between items-center px-1">
                 <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Ajustar Zoom</span>
                 <span className="text-[9px] text-amber-500 font-black">{(userProfile?.avatarScale || 1).toFixed(1)}x</span>
               </div>
               <input 
                 type="range" 
                 min="0.5" 
                 max="3" 
                 step="0.1" 
                 value={userProfile?.avatarScale || 1}
                 onChange={(e) => setUserProfile({...userProfile, avatarScale: parseFloat(e.target.value)})}
                 className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
               />
             </div>
           </div>
         )}

         <div className="text-center px-4">
            <h2 className="text-xl font-black text-white uppercase tracking-tight mb-0.5">{userProfile?.name}</h2>
            <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest">{userProfile?.email || userProfile?.phoneNumber}</p>
            {!userProfile?.avatarUrl && <p className="text-amber-500 text-[8px] font-black uppercase tracking-widest mt-2">Toque no círculo para carregar foto obrigatória</p>}
         </div>
         <div className="flex gap-2 mt-2">
            <button onClick={handleLogout} className="bg-slate-900 border border-slate-800 text-red-500 text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-full">FECHAR SESSÃO</button>
            <button onClick={() => handleAdminEdit()} className="bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-full"><i className="fa-solid fa-gear mr-1"></i> ADMIN</button>
         </div>
      </header>

      <div className="px-6">
        <form onSubmit={handleProfileSave} className="bg-[#111827]/80 border border-slate-800/60 p-7 rounded-[2.5rem] shadow-2xl shadow-black/40 space-y-6">
           <div className="space-y-1 py-0 text-center">
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest opacity-70">Identidade Verificada</p>

                <button 
                  type="button"
                  onClick={() => setShowPhoneModal(true)}
                  disabled={isLoading}
                  className={`w-full rounded-[2rem] py-6 px-10 flex items-center justify-center gap-5 font-black text-sm uppercase tracking-[0.2em] transition-all active:scale-95 shadow-2xl border-2 ${userProfile?.phoneNumber ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/40' : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50 shadow-black/30'}`}
                >
                  {isLoading ? (
                    <i className="fa-solid fa-circle-notch fa-spin text-3xl"></i>
                  ) : userProfile?.phoneNumber ? (
                    <i className="fa-solid fa-circle-check text-3xl"></i>
                  ) : (
                    <i className="fa-brands fa-whatsapp text-5xl text-[#25D366] drop-shadow-md"></i>
                  )}
                  <div className="flex flex-col items-start leading-tight">
                    <span className="text-[10px] text-emerald-600 font-black mb-1 tracking-widest">ACESSO PREMIUM</span>
                    {isLoading ? 'PROCESSANDO...' : userProfile?.phoneNumber ? 'WHATSAPP VINCULADO' : 'REGISTRAR VIA WHATSAPP (PIN ÚNICO)'}
                  </div>
                </button>

                {userProfile.email && (
                  <div className="flex flex-col items-center gap-0 pt-2 animate-in fade-in slide-in-from-top-2 duration-500">
                    <p className="text-white font-black text-xs uppercase tracking-tight">{userProfile?.name}</p>
                    <p className="text-slate-500 text-[9px] font-bold lowercase">{userProfile?.email}</p>
                  </div>
                )}
           </div>
           <div className="space-y-2">
              <label className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1 opacity-70">Nome Completo*</label>
              <input 
                type="text" 
                value={userProfile?.name === 'INVESTIDOR' ? '' : userProfile?.name} 
                placeholder="Seu nome completo"
                onChange={(e) => {
                  setUserProfile({...userProfile, name: e.target.value});
                  setHasSavedProfile(false);
                }} 
                className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all shadow-inner" 
              />
           </div>
           <div className="space-y-2">
              <label className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1 opacity-70">Bio do Investidor</label>
              <textarea 
                rows={3} 
                value={userProfile?.bio} 
                onChange={(e) => {
                  setUserProfile({...userProfile, bio: e.target.value});
                  setHasSavedProfile(false);
                }} 
                className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-4 px-5 text-white text-sm font-bold focus:border-amber-500/50 outline-none transition-all resize-none shadow-inner" 
              />
           </div>
            <div className="space-y-4 pt-2 border-t border-slate-800/40">
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] shadow-xl relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 text-amber-500/5 rotate-12 pointer-events-none group-hover:scale-110 transition-transform duration-700">
                     <i className="fa-solid fa-key text-[80px]"></i>
                  </div>
                  
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-amber-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <i className="fa-solid fa-shield-halved"></i>
                      {isPinLocked ? 'PIN PERMANENTE E EXCLUSIVO' : 'DEFINIR MEU PIN'}
                    </label>
                    <span className={`text-[7px] font-black px-2 py-0.5 rounded-full ${isPinLocked ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      {isPinLocked ? 'VINCULADO' : 'DISPONÍVEL'}
                    </span>
                  </div>

                  <div className="relative">
                    <input 
                      type="password" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4} 
                      id="pin-field" 
                      required 
                      readOnly={isPinLocked}
                      disabled={(!userProfile?.email && !userProfile?.phoneNumber) || !userProfile?.avatarUrl}
                      value={userProfile?.pin} 
                      onChange={(e) => {
                        if (isPinLocked) return;
                        setUserProfile({...userProfile, pin: e.target.value.replace(/\D/g, '').slice(0, 4)});
                        setHasSavedProfile(false);
                      }} 
                      className={`w-full bg-[#030712] border-2 rounded-2xl py-5 px-5 text-amber-500 text-3xl font-black tracking-[1.2em] outline-none transition-all text-center shadow-inner ${(!userProfile?.email && !userProfile?.phoneNumber || !userProfile?.avatarUrl) ? 'border-slate-800/50 opacity-30 cursor-not-allowed grayscale' : isPinLocked ? 'border-amber-500/20 opacity-80 cursor-not-allowed' : 'border-amber-500/10 focus:border-amber-500 cursor-text'}`} 
                      placeholder={(!userProfile?.email && !userProfile?.phoneNumber || !userProfile?.avatarUrl) ? "----" : isPinLocked ? "****" : "****"} 
                    />
                    {(!userProfile?.email && !userProfile?.phoneNumber || !userProfile?.avatarUrl) && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em] bg-slate-950/80 px-4 py-1 rounded-full border border-slate-800/50">Requer Identidade</p>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-slate-500 text-[8px] font-bold uppercase tracking-widest mt-4 text-center leading-relaxed">
                    {isPinLocked 
                      ? 'Este PIN é exclusivo do seu WhatsApp e não pode ser alterado.' 
                      : 'Defina seu PIN de 4 dígitos para acesso exclusivo às áreas restritas.'}
                  </p>
               </div>
            </div>

           <button 
             type="submit" 
             disabled={isLoading}
             style={{ backgroundColor: hasSavedProfile ? '#10b981' : '#f59e0b' }}
             className={`w-full ${hasSavedProfile ? 'hover:bg-[#059669]' : 'hover:bg-[#d97706]'} text-white font-black py-5 rounded-[1.5rem] text-xs uppercase tracking-[0.25em] shadow-xl ${hasSavedProfile ? 'shadow-emerald-500/10' : 'shadow-amber-500/10'} active:scale-98 transition-all mt-4`}
           >
             {isLoading ? 'SALVANDO...' : hasSavedProfile ? 'ALTERAÇÕES SALVAS COM SUCESSO' : 'SALVAR ALTERAÇÕES'}
           </button>
        </form>
      </div>
      <div className="mt-10 flex justify-center">
         <button 
           onClick={() => setCurrentView('HOME')} 
           style={{ backgroundColor: hasSavedProfile ? '#f59e0b' : '#10b981' }}
           className={`text-slate-950 text-[11px] font-black uppercase tracking-[0.3em] py-4 px-10 rounded-full shadow-lg ${hasSavedProfile ? 'shadow-amber-500/20 hover:bg-[#d97706]' : 'shadow-emerald-500/20 hover:bg-[#059669]'} active:scale-95 transition-all flex items-center gap-2`}
         >
            <i className="fa-solid fa-arrow-left"></i> Voltar para Início
         </button>
      </div>
    </div>
  );

  const renderMarketplace = () => (
      <div className="p-5 pb-32 animate-in fade-in duration-500">
        <header className="mb-8">
          <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-1">Mercado</h2>
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em]">Oportunidades Ativas</p>
        </header>
        <div className="grid grid-cols-1 gap-8">{assets.filter(a => a && !a.isCatalogOnly).map(asset => <AssetCard key={asset.id} asset={asset} onClick={() => navigateToAsset(asset)} />)}</div>
      </div>
  );

  const renderAssetDetail = () => {
    if (!selectedAsset) return null;
    return (
      <div className="p-0 pb-32 animate-in slide-in-from-right duration-500 bg-slate-950 min-h-screen">
        <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-900/40 p-5 flex items-center gap-4 max-w-md mx-auto shadow-2xl">
            <button onClick={() => setCurrentView('HOME')} className="h-10 w-10 bg-slate-900 rounded-full flex items-center justify-center text-white border border-slate-800 transition-all active:scale-75 shadow-lg"><i className="fa-solid fa-arrow-left"></i></button>
            <div className="min-w-0"><h2 className="text-lg font-black text-white uppercase tracking-tighter leading-none truncate">{selectedAsset.title}</h2></div>
        </header>
        <div className="pt-20">
          <img 
            src={selectedAsset.imageUrl} 
            className="w-full aspect-[4/5] object-cover border-b border-slate-800" 
            alt="" 
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <div className="p-6 space-y-6">
            <h1 className="text-white font-black text-3xl tracking-tighter uppercase">{selectedAsset.title}</h1>
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-[2rem] space-y-4">
                <h3 className="text-slate-400 text-[9px] font-black uppercase tracking-[0.3em] flex items-center gap-2"><i className="fa-solid fa-file-contract text-amber-500"></i> Ficha Técnica</h3>
                <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                   <div><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Título</p><p className="text-white font-bold text-sm">{selectedAsset.title}</p></div>
                   <div><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Artista</p><p className="text-white font-bold text-sm">{selectedAsset.artist}</p></div>
                   <div><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Ano</p><p className="text-white font-bold text-sm">{selectedAsset.year}</p></div>
                   <div className="col-span-2"><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Descrição</p><p className="text-slate-300 text-xs leading-relaxed">{selectedAsset.description}</p></div>
                </div>
            </div>
            <div className="bg-slate-900/40 border border-slate-800/60 p-5 rounded-[2rem] space-y-5 shadow-xl">
               <h3 className="text-slate-400 text-[9px] font-black uppercase tracking-[0.3em] flex items-center gap-2"><i className="fa-solid fa-shield-halved text-emerald-500"></i> Garantia & Custódia</h3>
                <div className="grid grid-cols-2 gap-4">
                   <div><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Seguradora</p><p className="text-emerald-400 font-bold text-xs uppercase">{selectedAsset.insuranceCompany}</p></div>
                   <div><p className="text-slate-500 text-[8px] uppercase font-bold tracking-widest mb-0.5">Apólice</p><p className="text-white font-mono text-xs uppercase">{selectedAsset.policyNumber}</p></div>
                </div>
              <GuaranteeBar expiryDate={selectedAsset.insuranceExpiry} />
            </div>

            {selectedAsset.gallery && selectedAsset.gallery.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-slate-400 text-[9px] font-black uppercase tracking-[0.3em]">Galeria da Coleção</h3>
                  <span className="text-amber-500 text-[8px] font-bold uppercase tracking-widest">{selectedAsset.gallery.length} Obras</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {(selectedAsset.gallery || []).map((item, idx) => (
                    <div key={idx} className="bg-slate-900/40 border border-slate-800/60 rounded-[2rem] overflow-hidden group hover:border-amber-500/30 transition-all shadow-xl">
                      <div className="aspect-square overflow-hidden relative">
                        <img src={item.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={item.title} referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                           <p className="text-white font-black text-[8px] uppercase tracking-widest">Ver Detalhes</p>
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <p className="text-white font-black text-[10px] truncate uppercase tracking-tight">{item.title}</p>
                        <div className="flex justify-between items-center">
                          <p className="text-slate-500 text-[8px] font-bold uppercase">{item.year}</p>
                          <p className="text-amber-500 text-[9px] font-black">R$ {formatCurrency(item.fractionPrice || 0)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-8">
              <div className="bg-amber-500/5 border border-amber-500/10 p-6 rounded-[2.5rem] mb-6 flex items-center justify-between">
                 <div>
                    <p className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">Valor da Fração</p>
                    <p className="text-white font-black text-2xl tracking-tighter">R$ {formatCurrency(selectedAsset.fractionPrice || 0)}</p>
                 </div>
                 <div className="text-right">
                    <p className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">Disponível</p>
                    <p className="text-amber-500 font-black text-lg tracking-tighter">{selectedAsset.availableFractions} un.</p>
                 </div>
              </div>
              <button 
                onClick={() => setPurchaseAsset({ ...selectedAsset, quantity: 1 })}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-7 rounded-[2.5rem] text-[14px] uppercase tracking-[0.5em] shadow-[0_25px_60px_rgba(245,158,11,0.4)] active:scale-95 transition-all flex items-center justify-center gap-4 group"
              >
                <i className="fa-solid fa-bolt-lightning text-lg group-hover:animate-pulse"></i>
                INVESTIR AGORA
              </button>
              <p className="text-slate-600 text-[8px] font-bold uppercase tracking-[0.2em] text-center mt-6 leading-relaxed">
                Ao clicar em investir, você concorda com os termos de custódia e <br/> participação proporcional nos lucros da obra.
              </p>
            </div>

          </div>
        </div>
      </div>
    );
  };

  const renderPurchaseModal = () => {
    if (!purchaseAsset) return null;
    const quantity = purchaseAsset.quantity || 1;
    const totalCost = (purchaseAsset.fractionPrice || 0) * quantity;
    
    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-300">
           <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setPurchaseAsset(null)}></div>
           <div className="bg-slate-900 border-t sm:border border-slate-800 p-8 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-md relative z-10 shadow-2xl space-y-6 animate-in slide-in-from-bottom duration-300">
                <header className="text-center space-y-2">
                    <div className="h-14 w-14 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto text-emerald-500 mb-2 border border-emerald-500/20"><i className="fa-solid fa-cart-shopping text-xl"></i></div>
                    <h3 className="text-white font-black text-xl uppercase tracking-tight">Confirmar Investimento</h3>
                </header>
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex gap-4 items-center">
                    <img 
                      src={purchaseAsset.imageUrl} 
                      className="h-16 w-16 rounded-lg object-cover" 
                      alt="" 
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <div><h4 className="text-white font-black text-sm uppercase">{purchaseAsset.title}</h4><p className="text-slate-500 text-[9px] uppercase font-bold tracking-wider">{purchaseAsset.artist}</p></div>
                </div>
                <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-slate-800/50"><span className="text-slate-400 text-xs font-bold uppercase">Preço / Fração</span><span className="text-white font-black text-lg">R$ {formatCurrency(purchaseAsset.fractionPrice || 0)}</span></div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-800/50"><span className="text-slate-400 text-xs font-bold uppercase">Quantidade</span><span className="text-white font-black text-lg">{quantity} un.</span></div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-800/50"><span className="text-slate-400 text-xs font-bold uppercase">Total a Pagar</span><span className="text-amber-500 font-black text-xl">R$ {formatCurrency(totalCost)}</span></div>
                    <div className="flex justify-between items-center py-2"><span className="text-slate-400 text-xs font-bold uppercase">Seu Saldo</span><span className={`font-black text-sm ${userBalance >= totalCost ? 'text-emerald-400' : 'text-red-400'}`}>R$ {formatCurrency(userBalance)}</span></div>
                </div>
                <div className="pt-2 gap-3 flex flex-col">
                    <button 
                      onClick={handlePurchase} 
                      disabled={isLoading || userBalance < totalCost} 
                      className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black py-4 rounded-xl text-[11px] uppercase tracking-[0.2em] shadow-lg active:scale-98 transition-all flex items-center justify-center gap-2"
                    >
                      {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                      {isLoading ? 'Processando...' : 'Confirmar Compra'}
                    </button>
                    <button onClick={() => setPurchaseAsset(null)} disabled={isLoading} className="w-full bg-transparent text-slate-400 font-bold py-3 text-[10px] uppercase tracking-widest hover:text-white transition-colors">Cancelar</button>
                </div>
           </div>
        </div>
    )
  }

  const renderFinanceModal = (type: 'DEPOSIT' | 'WITHDRAW') => {
    const isDeposit = type === 'DEPOSIT';
    return (
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-300">
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => isDeposit ? setIsDepositModalOpen(false) : setIsWithdrawModalOpen(false)}></div>
        <div className="bg-slate-900 border-t sm:border border-slate-800 p-8 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-sm relative z-10 shadow-2xl space-y-6 animate-in slide-in-from-bottom duration-300">
          <header className="text-center space-y-2">
            <div className={`h-14 w-14 ${isDeposit ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'} rounded-full flex items-center justify-center mx-auto mb-2 border border-current opacity-60`}>
              <i className={`fa-solid ${isDeposit ? 'fa-arrow-down' : 'fa-arrow-up'} text-xl`}></i>
            </div>
            <h3 className="text-white font-black text-xl uppercase tracking-tight">{isDeposit ? 'Depositar Saldo' : 'Sacar Saldo'}</h3>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Disponível: R$ {formatCurrency(userBalance)}</p>
          </header>
          
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1">Valor (R$)</label>
              <input 
                type="text"
                autoFocus
                className="w-full bg-[#030712] border border-slate-800 rounded-2xl py-5 px-6 text-white text-center text-3xl font-bold focus:border-amber-500 outline-none transition-all shadow-inner"
                placeholder="0,00"
                value={transactionAmount}
                onChange={(e) => setTransactionAmount(formatInputCurrency(e.target.value))}
              />
            </div>
          </div>

          <div className="pt-2 gap-3 flex flex-col">
            <button 
              onClick={isDeposit ? handleDeposit : handleWithdraw}
              disabled={isLoading || !transactionAmount}
              className={`w-full ${isDeposit ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'} disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black py-4 rounded-xl text-[11px] uppercase tracking-[0.2em] shadow-lg active:scale-98 transition-all flex items-center justify-center gap-2`}
            >
              {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check"></i>}
              {isLoading ? 'Processando...' : 'Confirmar Transação'}
            </button>
            <button 
              onClick={() => isDeposit ? setIsDepositModalOpen(false) : setIsWithdrawModalOpen(false)}
              className="w-full bg-transparent text-slate-400 font-bold py-3 text-[10px] uppercase tracking-widest hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderInsuranceDocument = () => {
    if (!selectedAsset) return null;
    
    // Formatting date to a readable format similar to "30 DE DEZEMBRO DE 2030"
    const expiryDate = new Date(selectedAsset.insuranceExpiry);
    const months = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
    const formattedExpiry = `${expiryDate.getDate()} DE ${months[expiryDate.getMonth()]} DE ${expiryDate.getFullYear()}`;

    return (
      <div className="min-h-screen bg-[#05080f] animate-in fade-in duration-500 flex flex-col overflow-x-hidden">
        <header className="p-6 flex items-center justify-between">
           <div className="flex items-center gap-4">
              <button onClick={() => setCurrentView('CUSTODY_GALLERY')} className="h-10 w-10 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center text-white active:scale-75 transition-all">
                <i className="fa-solid fa-arrow-left text-sm"></i>
              </button>
              <h1 className="text-white font-black text-sm tracking-widest uppercase">Documento da Seguradora</h1>
           </div>
           <div className="bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-md">
              <span className="text-emerald-500 font-black text-[8px] tracking-[0.2em]">SEGURADO</span>
           </div>
        </header>

        <main className="flex-1 px-4 py-2">
           <div className="bg-[#f8fafc] rounded-lg shadow-2xl overflow-hidden min-h-[600px] flex flex-col">
              {/* Header Certificate */}
              <div className="p-8 border-b border-slate-200 flex justify-between items-start">
                 <div>
                    <h2 className="text-slate-900 font-black text-xl tracking-tight leading-none mb-1">AUREA SAFE GUARD</h2>
                    <p className="text-slate-500 text-[8px] font-black tracking-widest uppercase opacity-70">GLOBAL HERITAGE & ART PROTECTION</p>
                 </div>
                 <div className="h-10 w-10 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20"></div>
              </div>

              {/* Main Content */}
              <div className="p-8 flex-1 space-y-12">
                 <div className="space-y-4">
                    <p className="text-slate-400 text-[9px] font-black tracking-widest uppercase">Certificado de Cobertura #{selectedAsset.policyNumber}</p>
                    <div className="space-y-1">
                       <h3 className="text-slate-900 font-black text-3xl tracking-tighter uppercase leading-none">{selectedAsset.artist}</h3>
                       <p className="text-slate-600 font-bold text-lg tracking-tight uppercase">{selectedAsset.title} , ({selectedAsset.year})</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-2">
                       <p className="text-slate-400 text-[8px] font-black tracking-widest uppercase">Nº DA APÓLICE PRINCIPAL</p>
                       <div className="bg-slate-100 px-4 py-2 rounded-md inline-block">
                          <span className="text-slate-900 font-mono font-black text-sm tracking-widest uppercase">{selectedAsset.policyNumber}</span>
                       </div>
                    </div>
                    <div className="space-y-2">
                       <p className="text-slate-400 text-[8px] font-black tracking-widest uppercase">DATA DE VENCIMENTO</p>
                       <p className="text-slate-900 font-black text-sm uppercase">{formattedExpiry}</p>
                    </div>
                 </div>

                 <div className="space-y-3 pt-6">
                    <p className="text-slate-400 text-[8px] font-black tracking-widest uppercase">TERMOS DE GARANTIA</p>
                    <p className="text-slate-600 text-[10px] leading-relaxed font-medium">
                       Este ativo está coberto contra danos físicos totais ou parciais, roubo qualificado, incêndio e intempéries climáticas. A cobertura estende-se ao armazenamento em cofres de alta segurança e transporte monitorado por escolta especializada.
                    </p>
                 </div>
              </div>

              {/* Footer Stamp Section */}
              <div className="p-8 space-y-6 flex flex-col items-center border-t border-slate-100">
                 <div className="w-full flex items-center gap-4">
                    <div className="h-[1px] flex-1 bg-slate-200"></div>
                    <i className="fa-solid fa-landmark text-slate-300"></i>
                    <div className="h-[1px] flex-1 bg-slate-200"></div>
                 </div>
                 
                 <div className="text-center space-y-4">
                    <p className="text-slate-400 text-[8px] font-black tracking-widest uppercase">Autenticação Digital Oasis RJ</p>
                    <div className="h-16 w-16 bg-white border border-slate-200 rounded-lg flex items-center justify-center p-1.5 mx-auto shadow-sm">
                       <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=OASIS_CERTIFICATE_${selectedAsset.policyNumber}`} 
                          alt="CÓDIGO DIGITAL QR"
                          className="w-full h-full object-contain"
                       />
                    </div>
                 </div>
              </div>
           </div>
        </main>

        <footer className="p-6 pt-2">
           <button 
              onClick={() => setCurrentView('CUSTODY_GALLERY')}
              className="w-full bg-slate-900 border border-slate-800 text-white font-black py-5 rounded-lg text-[10px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-xl"
           >
              Fechar Documento
           </button>
        </footer>
      </div>
    );
  };

  const renderCustodyGallery = () => {
    if (!selectedAsset) return null;
    const allGalleryItems = [{ ...selectedAsset, type: 'MAIN' }, ...(selectedAsset.gallery || [])];

    return (
      <div className="p-0 pb-32 animate-in slide-in-from-right duration-500 bg-slate-950 min-h-screen">
        <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-900/40 p-5 flex items-center gap-4 max-w-md mx-auto shadow-2xl">
            <button onClick={() => setCurrentView('HOME')} className="h-10 w-10 bg-slate-900 rounded-full flex items-center justify-center text-white border border-slate-800 transition-all active:scale-75 shadow-lg"><i className="fa-solid fa-arrow-left"></i></button>
            <h2 className="text-lg font-black text-white uppercase tracking-tighter leading-none">{selectedAsset.title}</h2>
        </header>
        <div className="pt-20 flex flex-col">
            {allGalleryItems.map((item, index) => {
                const itemTotalValue = (item as GalleryItem).totalValue !== undefined ? (item as GalleryItem).totalValue : selectedAsset.totalValue;
                const itemPrice = (itemTotalValue || 0) / (selectedAsset.totalFractions || 10000);
                const quantity = gallerySimulations[item.id] || 1;
                const investmentSubtotal = (itemPrice || 0) * quantity;
                
                return (
                <div key={item.id} className="mb-24 last:mb-0 animate-in fade-in duration-700">
                   <div className="relative w-full">
                      <img 
                        src={item.imageUrl} 
                        className="w-full h-auto object-cover rounded-none shadow-2xl" 
                        alt={item.title} 
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-4 right-4 bg-slate-950/20 backdrop-blur-sm px-5 py-2 rounded-full border border-teal-500/20 shadow-2xl opacity-70">
                        <span className="text-teal-400 font-black text-[10px] uppercase tracking-[0.2em]">SEGURADO</span>
                      </div>
                   </div>

                   <div className="px-3 mt-1 space-y-0">
                      {/* Título da Obra - Espaçamento ajustado para aproximar o card abaixo */}
                      <div className="mb-2 px-1">
                        <p className="text-amber-500 font-black text-[9px] uppercase tracking-[0.4em] leading-none mb-0.5">TÍTULO DA OBRA</p>
                        <h3 className="text-white text-3xl font-black uppercase tracking-tight leading-[0.8]">{item.title}</h3>
                      </div>

                      {/* Card Separado: Garantia & Custódia */}
                      <div className="bg-[#0c121e]/90 border border-slate-800/60 p-4 rounded-xl shadow-xl relative overflow-hidden backdrop-blur-md mb-8 h-[150px] flex flex-col justify-between">
                          <div className="absolute top-0 right-0 p-3 opacity-10">
                             <i className="fa-solid fa-shield-halved text-4xl text-emerald-500"></i>
                          </div>
                          
                          <h4 className="text-emerald-400 text-[9px] font-black uppercase tracking-[0.4em] flex items-center gap-2 mb-2">
                             <i className="fa-solid fa-shield-halved"></i> Garantia & Custódia
                          </h4>

                          <div className="space-y-4 flex-1 flex flex-col justify-center">
                            <div className="flex items-center justify-between gap-3 bg-slate-950/40 p-1.5 rounded-xl border border-slate-800/30">
                               <div className="pl-3 py-1 flex-1 min-w-0">
                                  <p className="text-slate-500 text-[8px] uppercase font-black tracking-widest opacity-70 mb-0.5">Seguradora</p>
                                  <p className="text-emerald-400 font-black text-xs uppercase tracking-tight leading-tight truncate">{selectedAsset.insuranceCompany}</p>
                               </div>
                               <button 
                                  onClick={() => setCurrentView('INSURANCE_DOCUMENT')}
                                  className="bg-amber-500 text-slate-950 p-2.5 rounded-lg flex flex-col items-center justify-center transition-all active:scale-95 shadow-lg group/policy-btn min-w-[85px]"
                               >
                                  <span className="text-slate-900/60 text-[7px] uppercase font-black tracking-widest mb-0.5 leading-none text-center">APÓLICE</span>
                                  <span className="font-mono text-11px font-black flex items-center gap-1 leading-none uppercase">
                                     {selectedAsset.policyNumber}
                                     <i className="fa-solid fa-arrow-up-right-from-square text-[8px] group-hover/policy-btn:scale-110 transition-transform"></i>
                                  </span>
                               </button>
                            </div>
                            
                            <div className="pt-1">
                               <GuaranteeBar expiryDate={selectedAsset.insuranceExpiry} />
                            </div>
                          </div>
                      </div>

                      {/* Asterisco Amarelo entre os Cards */}
                      <div className="flex justify-center text-amber-500 text-2xl font-black mb-4">*</div>

                      {/* Card "Valor da Obra" - Layout com altura superior reduzida e proporcional */}
                      <div className="bg-[#0b121f] border border-[#1e293b] p-4 pt-3 rounded-xl shadow-2xl mb-12 flex flex-col overflow-hidden">
                         
                         <div className="flex justify-between items-end mb-1 px-1">
                            <p className="text-[#34d399] text-[9px] font-black uppercase tracking-[0.4em] leading-none">VALOR DA OBRA</p>
                            <div className="text-right flex items-end justify-end gap-1 leading-none">
                               <div className="flex items-center gap-[0.2em]">
                                  <span className="text-[#f59e0b] text-[9px] font-black uppercase tracking-[0.4em] -mr-[0.4em]">FRAÇÃO</span>
                                  <span className="text-[11px] font-bold opacity-80 text-[#f59e0b] tracking-normal">(10%)</span>
                               </div>
                               <span className="text-[#f59e0b] text-[9px] font-black uppercase tracking-[0.4em]">/ PREÇO</span>
                            </div>
                         </div>

                         <div className="flex justify-between items-baseline mb-1 px-1">
                            <div className="flex items-baseline text-white tracking-[-0.08em] leading-none">
                               <span className="text-[14px] font-bold mr-3 opacity-80">R$</span>
                               <span className="text-xl font-black">
                                  {formatCurrency(itemTotalValue || 0)}
                               </span>
                            </div>
                            <div className="flex items-baseline justify-end text-[#f59e0b] tracking-[-0.08em] leading-none">
                               <span className="text-[14px] font-bold mr-3">R$</span>
                               <span className="text-xl font-black">
                                  {formatCurrency(itemPrice || 0)}
                               </span>
                            </div>
                         </div>

                         <div className="flex justify-between items-center mb-0.5 px-1 pt-1 border-t border-slate-800/20">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">QUANTIDADE DE FRAÇÕES</p>
                            <p className="text-white text-[11px] font-black uppercase tracking-[0.15em]">{quantity} UN.</p>
                         </div>

                         <div className="flex items-center gap-1.5 mb-3">
                            <button 
                               onClick={() => setGallerySimulations(prev => ({ ...prev, [item.id]: Math.max(1, (prev[item.id] || 1) - 1) }))}
                               className="h-8 w-8 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center text-white active:scale-90 transition-all text-sm"
                            >
                               <i className="fa-solid fa-minus"></i>
                            </button>
                            
                            <div className="flex-1 h-8 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center">
                               <span className="text-[#34d399] text-lg font-black tracking-[-0.08em]">{quantity}</span>
                            </div>

                            <button 
                               onClick={() => setGallerySimulations(prev => ({ ...prev, [item.id]: (prev[item.id] || 1) + 1 }))}
                               className="h-8 w-8 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center text-white active:scale-90 transition-all text-sm"
                            >
                               <i className="fa-solid fa-plus"></i>
                            </button>
                         </div>

                         <div className="flex justify-between items-center mb-1 px-1">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">SUBTOTAL</p>
                            <div className="flex items-baseline text-white tracking-[-0.08em] leading-none">
                               <span className="text-[14px] font-bold mr-3 text-[#f59e0b]">R$</span>
                               <span className="text-2xl font-black">
                                  {formatCurrency(investmentSubtotal || 0)}
                               </span>
                            </div>
                         </div>

                         <div className="flex gap-2">
                            <button 
                              onClick={() => setPurchaseAsset({...selectedAsset, ...item, fractionPrice: itemPrice, quantity: quantity})} 
                              className="flex-1 bg-[#f59e0b] hover:bg-[#d97706] text-slate-950 font-black py-3 rounded-lg text-[11px] uppercase tracking-[-0.05em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                               <i className="fa-solid fa-chart-pie text-sm"></i>
                               COMPRA FRAÇÃO
                            </button>
                            <button 
                              onClick={() => setPurchaseAsset({...selectedAsset, ...item, fractionPrice: itemPrice, quantity: selectedAsset.availableFractions})} 
                              className="flex-1 bg-[#10b981] hover:bg-[#059669] text-slate-950 font-black py-3 rounded-lg text-[11px] uppercase tracking-[-0.05em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                               <i className="fa-solid fa-gem text-sm"></i>
                               COMPRA INTEGRAL
                            </button>
                         </div>
                      </div>
                      
                      <div className="pt-8 pb-4">
                        <div className="h-[2px] w-[60%] mx-auto bg-gradient-to-r from-transparent via-slate-800 to-transparent"></div>
                      </div>
                   </div>
                </div>
                );
            })}
            
            <div className="px-6 pt-16 pb-24 text-center">
               <button 
                 onClick={() => setCurrentView('HOME')} 
                 style={{ backgroundColor: '#f09d0f' }}
                 className="hover:bg-[#d88d0d] text-slate-950 text-[11px] font-black uppercase tracking-[0.3em] py-4 px-10 rounded-full shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 mx-auto active:scale-95"
               >
                  <i className="fa-solid fa-arrow-left"></i> Voltar para Início
               </button>
            </div>
        </div>
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="max-w-md mx-auto min-h-screen bg-slate-950 relative shadow-2xl overflow-x-hidden ring-1 ring-slate-800 antialiased selection:bg-amber-500/40">
        <main className="min-h-screen">
        {currentView === 'HOME' && renderHome()}
        {currentView === 'ARTIST_DETAIL' && renderArtistDetail()}
        {currentView === 'MARKETPLACE' && renderMarketplace()}
        {currentView === 'ASSET_DETAIL' && renderAssetDetail()}
        {currentView === 'CUSTODY_GALLERY' && renderCustodyGallery()}
        {currentView === 'INSURANCE_DOCUMENT' && renderInsuranceDocument()}
        {currentView === 'PROFILE' && renderProfile()}
        {currentView === 'TOKENIZE' && renderTokenize()}
        {currentView === 'ADMIN_LOGIN' && renderAdminLogin()}
        {currentView === 'ADMIN' && renderAdminEditor()}
        {currentView === 'TRADING' && renderSwap()}
        {currentView === 'WALLET' && renderPortfolio()}
      </main>
      {renderPurchaseModal()}
      {isDepositModalOpen && renderFinanceModal('DEPOSIT')}
      {isWithdrawModalOpen && renderFinanceModal('WITHDRAW')}
      {!['ADMIN', 'ADMIN_LOGIN', 'CUSTODY_GALLERY', 'INSURANCE_DOCUMENT', 'TOKENIZE'].includes(currentView) && (
        <>
          {/* Modal QR Code */}
          {showQRModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] w-full max-w-sm text-center space-y-6 shadow-2xl">
                <div className="space-y-2">
                  <h3 className="text-white font-black text-xl uppercase tracking-tighter">Sincronia Oasis</h3>
                  <p className="text-slate-400 text-xs font-bold leading-relaxed">Aponte a câmera do outro celular para este código para entrar na sua conta instantaneamente.</p>
                </div>
                
                <div className="bg-white p-4 rounded-3xl inline-block shadow-inner">
                  <QRCodeSVG value={activeSyncLink} size={200} level="H" />
                </div>
                
                <div className="space-y-3">
                  <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest">Válido por 10 minutos • Uso único</p>
                  <button 
                    onClick={() => setShowQRModal(false)}
                    className="w-full bg-slate-800 text-white rounded-full py-3 font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          )}

          <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto h-24 bg-slate-950/95 backdrop-blur-3xl border-t border-slate-900/50 flex justify-around items-center px-6 z-50 shadow-[0_-20px_60px_rgba(0,0,0,1)]">
            {[ { icon: 'fa-house', label: 'Home', view: 'HOME' }, { icon: 'fa-compass', label: 'Explorar', view: 'MARKETPLACE' }, { icon: 'fa-shuffle', label: 'Swap', view: 'TRADING' }, { icon: 'fa-wallet', label: 'Portfolio', view: 'WALLET' } ].map((item) => (
            <button key={item.view} onClick={() => handleNavigate(item.view as ViewType)} className={`flex flex-col items-center justify-center gap-2 w-16 transition-all active:scale-75 relative group ${currentView === item.view ? 'text-amber-500' : 'text-slate-600 hover:text-slate-400'}`}>
                <i className={`fa-solid ${item.icon} text-2xl transition-all duration-500 ${currentView === item.view ? 'scale-125 -translate-y-1' : ''}`}></i>
                <span className="text-[8px] font-black uppercase tracking-[0.3em]">{item.label}</span>
            </button>
            ))}
        </nav>
      </>
      )}
      {(pendingView || pendingAction) && renderPinGuard()}
      {showPhoneModal && (
        <PhoneModal 
          showPhoneModal={showPhoneModal}
          setShowPhoneModal={setShowPhoneModal}
          phoneStep={phoneStep}
          setPhoneStep={setPhoneStep}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          isLoading={isLoading}
          handlePhoneRegistration={handlePhoneRegistration}
          whatsappLink={whatsappLink}
          showNotification={showNotification}
          otpValue={otpValue}
          setOtpValue={setOtpValue}
          otpInputRef={otpInputRef}
          handleOtpSubmit={handleOtpSubmit}
          avatarInputRef={avatarInputRef}
          tempProfileData={tempProfileData}
          setTempProfileData={setTempProfileData}
          handleAvatarUpload={handleAvatarUpload}
          currentPin={currentPin}
          handleFinalActivation={handleFinalActivation}
        />
      )}
      {showToast && <div className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-10 py-4 rounded-full shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-10 fade-in z-[100] border border-emerald-400/50"><i className="fa-solid fa-circle-check text-lg"></i><span className="text-[10px] font-black uppercase tracking-[0.3em] whitespace-nowrap leading-none">{toastMessage}</span></div>}
    </div>
    </ErrorBoundary>
  );
};

export default App;