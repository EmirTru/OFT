// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, query, addDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// ######################################################################################
// ############################# YAPILANDIRMA BİLGİLERİ #################################
// ######################################################################################
// Kullanıcı tarafından sağlanan güncel Firebase yapılandırması
const firebaseConfig = {
  apiKey: "AIzaSyCEFhB9MfxQwR155xyieDR-XvH-okrNwmY",
  authDomain: "oftm-558a4.firebaseapp.com",
  projectId: "oftm-558a4",
  storageBucket: "oftm-558a4.firebasestorage.app",
  messagingSenderId: "47400435564",
  appId: "1:47400435564:web:f0c2606ec874882c8c7d49",
  measurementId: "G-LFBW2F9T7T"
};

// Uygulama kimliğini bu şekilde ayarlıyoruz, Firestore yolları için kullanılacak
const appId = firebaseConfig.projectId;

// Firebase services
let app, db, auth;

// State variables
let stream = null;
let mediaGallery = [];
let chatMessages = [];
let isRecording = false;
let isSending = false;
let mediaCode = '';
let connectionCode = null;
let isVerici = false;
let isConnecting = false;
let userId = null;
let connectionStatus = 'Bağlantı bekleniyor...';
let modalMessage = null;
let modalType = 'success';
let isFirebaseReady = false;

// DOM elements
const appRoot = document.getElementById('app-root');
const videoRef = document.getElementById('camera-video');
const canvasRef = document.getElementById('camera-canvas');
let mediaRecorder = null;
let chunks = [];

// Helper function: Concatenates Tailwind classes
const cn = (...classes) => classes.filter(Boolean).join(' ');

// Function to show modal
const showModal = (message, type) => {
    modalMessage = message;
    modalType = type;
    renderUI();
};

// Function to close modal
const closeModal = () => {
    modalMessage = null;
    renderUI();
};

// Sets up Firestore listeners
const setupFirestoreListeners = () => {
    if (!isFirebaseReady || !connectionCode || !userId) return;

    // Listen to Media Gallery
    const mediaCollectionRef = collection(db, `/artifacts/${appId}/public/data/connections/${connectionCode}/media`);
    const unsubscribeMedia = onSnapshot(mediaCollectionRef, (querySnapshot) => {
        const mediaList = [];
        querySnapshot.forEach((doc) => {
            mediaList.push({ id: doc.id, ...doc.data() });
        });
        mediaList.sort((a, b) => b.timestamp - a.timestamp);
        mediaGallery = mediaList;
        renderUI();
    }, (error) => {
        console.error("Firestore media read error:", error);
        connectionStatus = 'Media connection error.';
        renderUI();
    });

    // Listen to Chat Messages
    const chatCollectionRef = collection(db, `/artifacts/${appId}/public/data/connections/${connectionCode}/chat`);
    const unsubscribeChat = onSnapshot(chatCollectionRef, (querySnapshot) => {
        const chatList = [];
        querySnapshot.forEach((doc) => {
            chatList.push({ id: doc.id, ...doc.data() });
        });
        chatList.sort((a, b) => a.timestamp - b.timestamp);
        chatMessages = chatList;
        renderUI();
        const chatEndRef = document.getElementById('chat-end');
        if (chatEndRef) {
            chatEndRef.scrollIntoView({ behavior: 'smooth' });
        }
    }, (error) => {
        console.error("Firestore chat read error:", error);
    });

    return { unsubscribeMedia, unsubscribeChat };
};

let unsubscribeFunctions = { unsubscribeMedia: null, unsubscribeChat: null };

// Creates a new connection code
const createConnection = async () => {
    if (!isFirebaseReady || !userId) {
        showModal("Firebase is loading, please wait.", 'error');
        return;
    }
    isConnecting = true;
    renderUI();
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const connectionDocRef = doc(db, `/artifacts/${appId}/public/data/connections`, newCode);
    
    try {
        // Bağlantı oluşturma işlemi için 10 saniyelik bir zaman aşımı (timeout) ekledik
        await Promise.race([
            setDoc(connectionDocRef, {
                creatorId: userId,
                status: 'waiting',
                timestamp: Date.now(),
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection creation timed out.')), 10000))
        ]);
        
        connectionCode = newCode;
        isVerici = true;
        connectionStatus = `Sender code: ${newCode}. Waiting for receiver...`;
        unsubscribeFunctions = setupFirestoreListeners();
    } catch (e) {
        console.error("Firestore connection creation error:", e);
        showModal(`Bağlantı oluşturulamadı: ${e.message || 'Bilinmeyen bir hata oluştu.'}`, 'error');
    } finally {
        // İşlem bittiğinde isConnecting durumunu sıfırlıyoruz
        isConnecting = false;
        renderUI();
    }
};

// Joins a connection
const joinConnection = async () => {
    if (!isFirebaseReady || !userId) {
        showModal("Firebase is loading, please wait.", 'error');
        return;
    }
    isConnecting = true;
    connectionStatus = 'Connecting...';
    renderUI();

    const connectionDocRef = doc(db, `/artifacts/${appId}/public/data/connections`, mediaCode);
    try {
        // Bağlantıya katılma işlemi için 10 saniyelik bir zaman aşımı (timeout) ekledik
        const docSnap = await Promise.race([
            getDoc(connectionDocRef),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection lookup timed out.')), 10000))
        ]);

        if (docSnap.exists()) {
            connectionCode = mediaCode;
            isVerici = false;
            connectionStatus = 'Connection successful! Switching to camera...';
            await startCamera();
            unsubscribeFunctions = setupFirestoreListeners();
        } else {
            connectionStatus = 'Wrong code or connection not found.';
            showModal('Connection not found. Please check the code.', 'error');
        }
    } catch (e) {
        console.error("Firestore connection error:", e);
        connectionStatus = 'Connection error.';
        showModal(`Bağlantı hatası: ${e.message || 'Bilinmeyen bir hata oluştu.'}`, 'error');
    } finally {
        // İşlem bittiğinde isConnecting durumunu sıfırlıyoruz
        isConnecting = false;
        renderUI();
    }
};

// Starts camera access
const startCamera = async () => {
    try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream = mediaStream;
        videoRef.srcObject = mediaStream;
        videoRef.play();
        connectionStatus = 'Camera ready. You can take photos or videos.';
    } catch (err) {
        console.error("Camera access failed:", err);
        connectionStatus = "Camera access failed. Please check permissions.";
        showModal("Camera access denied. Please grant permissions in your browser settings.", 'error');
    }
};

// Takes a photo and sends it to Firestore
const takePhoto = async () => {
    if (!videoRef || !canvasRef || !connectionCode) return;
    isSending = true;
    renderUI();

    const context = canvasRef.getContext('2d');
    canvasRef.width = videoRef.videoWidth;
    canvasRef.height = videoRef.videoHeight;
    context.drawImage(videoRef, 0, 0, videoRef.videoWidth, videoRef.videoHeight);
    const photoDataUrl = canvasRef.toDataURL('image/png');
    
    const mediaCollectionRef = collection(db, `/artifacts/${appId}/public/data/connections/${connectionCode}/media`);
    try {
        await addDoc(mediaCollectionRef, {
            type: 'photo',
            data: photoDataUrl,
            timestamp: Date.now(),
        });
        showModal("Photo sent successfully!", 'success');
    } catch (e) {
        console.error("Firestore photo send error:", e);
        showModal("An error occurred while sending the photo.", 'error');
    } finally {
        isSending = false;
        renderUI();
    }
};

// Starts video recording
const startRecording = () => {
    if (!stream || !connectionCode) return;
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            chunks.push(e.data);
        }
    };

    mediaRecorder.onstop = async () => {
        isSending = true;
        renderUI();
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const videoDataUrl = reader.result;
            const mediaCollectionRef = collection(db, `/artifacts/${appId}/public/data/connections/${connectionCode}/media`);
            try {
                await addDoc(mediaCollectionRef, {
                    type: 'video',
                    data: videoDataUrl,
                    timestamp: Date.now(),
                });
                showModal("Video sent successfully!", 'success');
            } catch (e) {
                console.error("Firestore video send error:", e);
                showModal("An error occurred while sending the video.", 'error');
            } finally {
                isSending = false;
                renderUI();
            }
        };
    };

    mediaRecorder.start();
    isRecording = true;
    renderUI();
};

// Stops video recording
const stopRecording = () => {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        renderUI();
    }
};

// Sends a chat message
const sendChatMessage = async () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput && chatInput.value.trim() === '' || !connectionCode) return;
    
    const chatCollectionRef = collection(db, `/artifacts/${appId}/public/data/connections/${connectionCode}/chat`);
    try {
        await addDoc(chatCollectionRef, {
            message: chatInput.value,
            senderId: userId,
            timestamp: Date.now(),
        });
        chatInput.value = '';
    } catch (e) {
        console.error("Chat message send error:", e);
        showModal("An error occurred while sending the message.", 'error');
    }
};

// Resets the application
const resetApp = () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (unsubscribeFunctions.unsubscribeMedia) unsubscribeFunctions.unsubscribeMedia();
    if (unsubscribeFunctions.unsubscribeChat) unsubscribeFunctions.unsubscribeChat();

    stream = null;
    mediaGallery = [];
    chatMessages = [];
    isVerici = false;
    isRecording = false;
    isSending = false;
    mediaCode = '';
    connectionCode = null;
    connectionStatus = 'Waiting for connection...';
    
    renderUI();
};

// Main function to create and update the UI
const renderUI = () => {
    appRoot.innerHTML = '';
    
    // Modal
    if (modalMessage) {
        const icon = modalType === 'success' ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-8.62"/><path d="m9 11 3 3L22 4"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-400"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
        const title = modalType === 'success' ? 'Success' : 'Error';
        const bgColor = modalType === 'success' ? 'bg-green-900' : 'bg-red-900';
        
        const modalHTML = `
            <div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
              <div class="${cn("rounded-xl p-6 shadow-2xl flex flex-col items-center space-y-4", bgColor)}">
                ${icon}
                <h3 class="text-xl font-bold text-white">${title}</h3>
                <p class="text-center text-gray-200">${modalMessage}</p>
                <button id="modal-close-btn" class="w-full p-2 rounded-lg bg-white bg-opacity-20 hover:bg-opacity-30 transition-all font-semibold">
                  OK
                </button>
              </div>
            </div>
        `;
        appRoot.insertAdjacentHTML('afterbegin', modalHTML);
        document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    }

    // Main app content
    let mainContentHTML = ``;

    if (!isFirebaseReady) {
      mainContentHTML = `
        <div id="loading-spinner" class="flex flex-col items-center justify-center h-64">
          <div class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
          <p class="mt-4 text-gray-400">Loading...</p>
        </div>
      `;
    } else {
      mainContentHTML += `
        <!-- Title and reset button -->
        <header class="flex justify-between items-center pb-4 border-b border-gray-700">
            <h1 class="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">
                Camera App 📸
            </h1>
            <button id="reset-btn" class="flex items-center text-gray-400 hover:text-white transition-colors duration-200">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M3 12a9 9 0 0 1 9-9c2.97 0 5.71 1.18 7.72 3.19M21 12a9 9 0 0 1-9 9c-2.97 0-5.71-1.18-7.72-3.19M3 4V2h2M21 22v-2h-2"/><path d="M12 2a10 10 0 0 0-10 10"/><path d="M22 12a10 10 0 0 1-10 10"/></svg>
                Reset
            </button>
        </header>

        <!-- Connection Status -->
        <div class="flex items-center justify-center p-3 rounded-lg bg-gray-700 text-sm font-medium">
            ${isConnecting || isSending ? '<span class="animate-pulse">Processing...</span>' : `<span>${connectionStatus}</span>`}
        </div>
      `;
      
      if (!connectionCode) {
          mainContentHTML += `
              <!-- Connection Interface -->
              <div class="flex flex-col md:flex-row space-y-6 md:space-y-0 md:space-x-6 p-8">
                  <div class="flex-1 flex flex-col items-center justify-center p-6 bg-gray-700 rounded-lg shadow-inner space-y-4">
                      <h2 class="text-xl md:text-2xl font-semibold text-center">Sender (Display)</h2>
                      <p class="text-center text-gray-400">
                          Create a connection code to receive photos/videos from another device.
                      </p>
                      <button id="create-connection-btn" class="w-full flex items-center justify-center p-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-all shadow-md disabled:bg-gray-500" ${isConnecting ? 'disabled' : ''}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          Create Connection
                      </button>
                  </div>
                  <div class="flex-1 flex flex-col items-center justify-center p-6 bg-gray-700 rounded-lg shadow-inner space-y-4">
                      <h2 class="text-xl md:text-2xl font-semibold text-center">Receiver (Camera)</h2>
                      <p class="text-center text-gray-400">
                          Enter the code from the sender device to connect and send media.
                      </p>
                      <div class="flex flex-col w-full space-y-2">
                          <input id="media-code-input" type="text" value="${mediaCode}" placeholder="Enter code..." class="w-full p-3 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                          <button id="join-connection-btn" class="w-full flex items-center justify-center p-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all shadow-md disabled:bg-gray-500" ${isConnecting || mediaCode.length !== 6 ? 'disabled' : ''}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                              Connect
                          </button>
                      </div>
                  </div>
              </div>
          `;
      } else {
          let mediaSection = '';
          if (!isVerici && stream) {
              mediaSection = `<div class="w-full h-full"><video id="camera-video-display" class="w-full h-full object-cover rounded-xl" autoplay playsinline></video></div>`;
          } else if (isVerici && mediaGallery.length === 0) {
              mediaSection = `<div class="text-gray-400 p-4 text-center">Waiting for media from the receiver device...</div>`;
          } else if (isVerici && mediaGallery.length > 0) {
              mediaSection = `<div id="media-gallery" class="w-full h-full p-2 grid grid-cols-2 gap-2 overflow-y-auto">
                  ${mediaGallery.map(media => `
                      <div class="relative rounded-lg overflow-hidden border border-gray-600">
                          ${media.type === 'photo' ? `<img src="${media.data}" alt="Received Photo" class="w-full h-auto object-cover" />` : `<video src="${media.data}" controls class="w-full h-auto object-cover"></video>`}
                      </div>
                  `).join('')}
              </div>`;
          }

          let controlSection = '';
          if (!isVerici) {
              controlSection = `
                  <div class="w-full md:w-1/2 flex flex-col space-y-4">
                      <div class="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
                          <button id="take-photo-btn" class="flex-1 flex items-center justify-center p-4 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-all shadow-md disabled:bg-gray-500" ${isSending ? 'disabled' : ''}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                              ${isSending ? 'Sending...' : 'Take Photo'}
                          </button>
                          <button id="record-video-btn" class="${cn('flex-1 flex items-center justify-center p-4 rounded-lg text-white font-semibold transition-all shadow-md disabled:bg-gray-500', isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700')}" ${isSending ? 'disabled' : ''}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                              ${isRecording ? 'Stop Recording' : 'Record Video'}
                          </button>
                      </div>
                      <div class="flex-1 mt-6 p-4 rounded-xl bg-gray-700 shadow-inner overflow-hidden flex items-center justify-center text-gray-400">
                          You are in camera mode. The media you take will be sent to the other device.
                      </div>
                  </div>
              `;
          } else {
              controlSection = `
                  <div class="w-full md:w-1/2 flex flex-col space-y-4">
                      <div class="flex-1 flex flex-col space-y-4">
                          <div class="p-4 rounded-xl bg-gray-700 shadow-inner overflow-hidden flex flex-col h-full">
                              <h3 class="text-lg font-bold mb-2 flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2 text-blue-400"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                  Chat
                              </h3>
                              <div id="chat-messages-container" class="flex-1 overflow-y-auto p-2 bg-gray-800 rounded-lg mb-2 flex flex-col space-y-2">
                                  ${chatMessages.map(msg => `
                                      <div class="${cn('p-2 rounded-lg max-w-[80%]', msg.senderId === userId ? 'bg-blue-600 self-end text-right' : 'bg-gray-600 self-start text-left')}">
                                          <p class="text-sm">${msg.message}</p>
                                          <span class="text-xs text-gray-300 mt-1 block">
                                              ${new Date(msg.timestamp).toLocaleTimeString()}
                                          </span>
                                      </div>
                                  `).join('')}
                                  <div id="chat-end"></div>
                              </div>
                              <div class="flex space-x-2">
                                  <input id="chat-input" type="text" placeholder="Type a message..." class="flex-1 p-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                  <button id="send-chat-btn" class="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-md">
                                      Send
                                  </button>
                              </div>
                          </div>
                      </div>
                  `;
              }

              mainContentHTML += `
                  <div class="flex flex-col md:flex-row space-y-6 md:space-y-0 md:space-x-6">
                      <div class="relative w-full md:w-1/2 rounded-xl overflow-hidden shadow-xl border-2 border-gray-700 bg-gray-900 flex items-center justify-center">
                          ${mediaSection}
                      </div>
                      ${controlSection}
                  </div>
              `;
          }
    }

    appRoot.innerHTML = mainContentHTML;
    
    // Add event listeners
    document.getElementById('reset-btn')?.addEventListener('click', resetApp);
    
    if (!connectionCode) {
        document.getElementById('create-connection-btn')?.addEventListener('click', createConnection);
        const mediaCodeInput = document.getElementById('media-code-input');
        const joinButton = document.getElementById('join-connection-btn');
        
        mediaCodeInput?.addEventListener('input', (e) => {
            mediaCode = e.target.value.toUpperCase();
            joinButton.disabled = isConnecting || mediaCode.length !== 6;
        });
        joinButton?.addEventListener('click', joinConnection);
    } else {
        // Camera or chat buttons
        if (!isVerici) {
            document.getElementById('take-photo-btn')?.addEventListener('click', takePhoto);
            const recordVideoBtn = document.getElementById('record-video-btn');
            recordVideoBtn?.addEventListener('click', () => {
                if (isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            });
        } else {
            document.getElementById('send-chat-btn')?.addEventListener('click', sendChatMessage);
            document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendChatMessage();
                }
            });
        }
    }

    // Add video and canvas to the DOM (hidden)
    if (!document.body.contains(videoRef)) {
      videoRef.style.display = 'none';
      document.body.appendChild(videoRef);
    }
    if (!document.body.contains(canvasRef)) {
      canvasRef.style.display = 'none';
      document.body.appendChild(canvasRef);
    }

    // Assign video element for camera stream
    if (!isVerici && connectionCode) {
        const videoDisplay = document.getElementById('camera-video-display');
        if (videoDisplay) {
            videoRef.srcObject = stream;
            videoDisplay.srcObject = stream;
        }
    }
};

// Firebase initialization function
// ######################################################################################
// ############################# HATA DÜZELTME BİLGİLENDİRMESİ #############################
// ######################################################################################
// 'auth/configuration-not-found' hatası, Firebase projenizin konsol ayarlarından kaynaklanıyor.
// Uygulamanın anonim olarak oturum açabilmesi için, Firebase konsolunuzda
// "Authentication" -> "Sign-in method" bölümüne giderek "Anonymous" sağlayıcısını
// etkinleştirmeniz gerekmektedir. Kod tarafında bu hatayı çözmek mümkün değildir.
// Bu ayarı yaptıktan sonra, uygulama sorunsuz çalışacaktır.
// ######################################################################################
const initFirebase = async () => {
    try {
        // Check if Firebase config has been set
        if (firebaseConfig.apiKey === "YOUR_API_KEY") {
            showModal("Please update firebaseConfig with your own project keys.", 'error');
            isFirebaseReady = false;
            renderUI();
            return;
        }
        
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set up listener after Firebase services are successfully initialized
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isFirebaseReady = true;
                renderUI();
            } else {
                try {
                    // Sign in anonymously for a simple, token-less auth solution
                    await signInAnonymously(auth);
                } catch (e) {
                    console.error("Firebase Auth error:", e);
                    // Hata mesajını daha anlaşılır hale getiriyoruz
                    let errorMessage = `An error occurred while connecting to Firebase: ${e.message}`;
                    if (e.code === 'auth/configuration-not-found') {
                         errorMessage = 'Hata: Firebase projenizde "Anonymous" (Anonim) oturum açma yöntemi etkinleştirilmemiş. Lütfen Firebase konsolundan bu ayarı yapın.';
                    }
                    showModal(errorMessage, 'error');
                    isFirebaseReady = false;
                    renderUI();
                }
            }
        });

    } catch (e) {
        console.error("Firebase initialization error:", e);
        showModal("An error occurred while starting the application: Firebase configuration may be incorrect.", 'error');
        isFirebaseReady = false;
        renderUI();
    }
};

// Start the application
initFirebase();
