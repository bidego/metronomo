class Metronome {
    // Métodos para el control de wake lock (evitar que la pantalla se apague)
    async requestWakeLock() {
        // Verificar si la API está disponible
        if ('wakeLock' in navigator) {
            try {
                // Liberar cualquier wake lock anterior
                this.releaseWakeLock();
                
                // Solicitar un nuevo wake lock
                this.wakeLock = await navigator.wakeLock.request('screen');
                
                console.log('Wake Lock activado');
                
                // Agregar un controlador de eventos para liberar el bloqueo si la página se oculta
                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock liberado');
                });
                
                return true;
            } catch (err) {
                console.error(`Error al solicitar Wake Lock: ${err.name}, ${err.message}`);
                return false;
            }
        } else {
            console.warn('Wake Lock API no soportada en este navegador');
            return false;
        }
    }
    
    releaseWakeLock() {
        if (this.wakeLock) {
            try {
                this.wakeLock.release();
                this.wakeLock = null;
                console.log('Wake Lock liberado manualmente');
            } catch (err) {
                console.error(`Error al liberar Wake Lock: ${err}`);
            }
        }
    }
    constructor() {
        // Inicializar Web Audio API
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.isPlaying = false;
        this.tempo = 120;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.scheduleAheadTime = 0.1; // Tiempo de anticipación en segundos
        this.lookAheadBuffer = 0.25; // Buffer de anticipación adicional para compensar retrasos (250ms)
        this.currentSound = 'metClick';
        this.buffers = {}; // Para almacenar los buffers de audio
        
        // Corrección de desviación temporal
        this.expectedNextNoteTime = 0; // Tiempo esperado para la próxima nota
        this.timeCorrection = 0; // Corrección acumulada
        this.timingHistory = []; // Historial de desviaciones
        this.maxTimingHistory = 10; // Cantidad máxima de entradas en el historial
        this.stabilityThreshold = 0.025; // Umbral de desviación en segundos (25ms)
        
        // No sleep mode
        this.wakeLock = null; // Para almacenar la referencia al wake lock
        
        // URLs de sonidos
        this.soundUrls = {
            // Sonidos originales
            click: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/clap.wav',
            woodblock: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/tink.wav',
            cowbell: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/ride.wav',
            hihat: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/hihat.wav',
            snare: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/snare.wav',
            tom: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/tom.wav',
            kick: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/kick.wav',
            boom: 'https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/boom.wav',
            
            // Sonidos de metrónomo profesional
            metClick: 'https://cdn.freesound.org/previews/548/548518_1442200-lq.mp3',
            metBell: 'https://cdn.freesound.org/previews/191/191959_736471-lq.mp3',
            metWood: 'https://cdn.freesound.org/previews/684/684953_14228776-lq.mp3',
            metTick: 'https://cdn.freesound.org/previews/250/250551_4570971-lq.mp3',
            metStick: 'https://cdn.freesound.org/previews/708/708309_15362740-lq.mp3'
        };
        
        // DOM Elements
        this.tempoSlider = document.getElementById('tempo');
        this.bpmValue = document.getElementById('bpm-value');
        this.startStopBtn = document.getElementById('start-stop');
        this.soundSelect = document.getElementById('soundSelect');
        this.songNameInput = document.getElementById('song-name');
        this.songBpmInput = document.getElementById('song-bpm');
        this.addSongBtn = document.getElementById('add-song');
        this.songsList = document.getElementById('songs');
        this.shareBtn = document.getElementById('share-btn');

        // Intentar cargar canciones desde el hash de la URL o del almacenamiento local
        this.songs = this.loadSongsFromHash() || JSON.parse(localStorage.getItem('songs')) || [];

        this.preloadSounds();
        this.initializeEventListeners();
        this.renderSongs();
    }

    initializeEventListeners() {
        this.tempoSlider.addEventListener('input', () => {
            this.tempo = Number(this.tempoSlider.value);
            this.bpmValue.textContent = this.tempo;
            // No necesitamos reiniciar para cambiar el tempo
            // con Web Audio API el cambio se reflejará en la siguiente nota
        });

        this.startStopBtn.addEventListener('click', () => {
            if (this.isPlaying) {
                this.stop();
            } else {
                this.start();
            }
        });
        
        // Agregar escuchador para detectar cuando el documento vuelve a estar visible
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isPlaying) {
                // Si volvemos a la página y el metrónomo estaba sonando, solicitar wake lock nuevamente
                this.requestWakeLock();
            }
        });

        this.soundSelect.addEventListener('change', () => {
            this.currentSound = this.soundSelect.value;
        });

        this.addSongBtn.addEventListener('click', () => {
            this.addSong();
        });
        
        // Configurar tap tempo en la interfaz principal
        const tapTempoBtn = document.getElementById('tap-tempo');
        if (tapTempoBtn) {
            // Inicializar variables para el tap tempo
            let tapTimes = [];
            let tapTimeout;
            
            tapTempoBtn.addEventListener('click', () => {
                const now = Date.now();
                
                // Limitar a los últimos 4 taps
                if (tapTimes.length >= 4) {
                    tapTimes.shift();
                }
                
                tapTimes.push(now);
                
                // Cancelar el timeout anterior si existe
                if (tapTimeout) {
                    clearTimeout(tapTimeout);
                }
                
                // Calcular BPM si hay suficientes taps
                if (tapTimes.length >= 2) {
                    const intervals = [];
                    for (let i = 1; i < tapTimes.length; i++) {
                        intervals.push(tapTimes[i] - tapTimes[i-1]);
                    }
                    
                    // Promedio de intervalos
                    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
                    
                    // Convertir a BPM (60000 ms = 1 minuto)
                    const calculatedBpm = Math.round(60000 / avgInterval);
                    
                    // Limitar al rango válido
                    const finalBpm = Math.min(Math.max(calculatedBpm, 40), 208);
                    
                    // Actualizar el tempo
                    this.tempo = finalBpm;
                    this.tempoSlider.value = finalBpm;
                    this.bpmValue.textContent = finalBpm;
                    
                    // Si está tocando, reiniciar para aplicar el nuevo tempo
                    if (this.isPlaying) {
                        this.stop();
                        this.start();
                    }
                    
                    // Mostrar efecto visual en el BPM
                    this.bpmValue.classList.add('highlight-bpm');
                    setTimeout(() => {
                        this.bpmValue.classList.remove('highlight-bpm');
                    }, 500);
                }
                
                // Efecto visual del botón
                tapTempoBtn.classList.add('tapped');
                setTimeout(() => {
                    tapTempoBtn.classList.remove('tapped');
                }, 150);
                
                // Resetear después de 2 segundos sin tap
                tapTimeout = setTimeout(() => {
                    tapTimes = [];
                }, 2000);
            });
        }
        
        // Eventos para compartir lista
        if (this.shareBtn) {
            this.shareBtn.addEventListener('click', () => {
                this.showShareModal();
            });
            
            const closeShareBtn = document.getElementById('close-share-modal');
            if (closeShareBtn) {
                closeShareBtn.addEventListener('click', () => {
                    this.hideShareModal();
                });
            }
            
            const copyUrlBtn = document.getElementById('copy-url');
            if (copyUrlBtn) {
                copyUrlBtn.addEventListener('click', () => {
                    this.copyShareUrl();
                });
            }
            
            const shareWhatsappBtn = document.getElementById('share-whatsapp');
            if (shareWhatsappBtn) {
                shareWhatsappBtn.addEventListener('click', () => {
                    this.shareViaWhatsApp();
                });
            }
            
            const shareEmailBtn = document.getElementById('share-email');
            if (shareEmailBtn) {
                shareEmailBtn.addEventListener('click', () => {
                    this.shareViaEmail();
                });
            }
        }
    }

    preloadSounds() {
        // Cargar todos los sonidos como AudioBuffers
        Object.keys(this.soundUrls).forEach(key => {
            const url = this.soundUrls[key];
            fetch(url)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    this.buffers[key] = audioBuffer;
                })
                .catch(e => console.error(`Error cargando el sonido ${key}:`, e));
        });
    }
    
    playSound(time = 0) {
        // Verificar si el buffer está cargado
        if (!this.buffers[this.currentSound]) {
            return; // El buffer aún no está disponible
        }

        // Crear un nodo de fuente de sonido
        const source = this.audioContext.createBufferSource();
        source.buffer = this.buffers[this.currentSound];
        
        // Crear un nodo de ganancia para controlar el volumen
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0; // Volumen completo
        
        // Conectar fuente -> ganancia -> destino
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Programar la reproducción del sonido con margen de seguridad
        // Si el tiempo programado ya pasó, reproducir inmediatamente
        const safeTime = Math.max(time, this.audioContext.currentTime);
        source.start(safeTime);
        
        // Agregar un evento para verificar la latencia real de reproducción
        // Esto podría ayudar a refinar aún más la corrección temporal
        if ('performance' in window) {
            const scheduledTime = time;
            const actualStartTime = this.audioContext.currentTime;
            
            // Calcular latencia entre tiempo programado y tiempo real
            const latency = actualStartTime - scheduledTime;
            
            // Solo registrar latencias positivas (atrasos) que no sean extremas
            if (latency > 0 && latency < 0.1) {
                // Llevar un registro de latencias para análisis
                if (!this.latencies) this.latencies = [];
                this.latencies.push(latency);
                
                // Limitar tamaño de historial de latencias
                if (this.latencies.length > 20) {
                    this.latencies.shift();
                }
                
                // Ajustar buffer de anticipación dinámicamente según latencia promedio
                if (this.latencies.length >= 10) {
                    const avgLatency = this.latencies.reduce((sum, val) => sum + val, 0) / this.latencies.length;
                    // Establecer buffer como 2x la latencia promedio + margen
                    this.lookAheadBuffer = Math.min(Math.max(avgLatency * 2 + 0.1, 0.2), 0.5);
                }
            }
        }
    }

    scheduler() {
        const currentTime = this.audioContext.currentTime;
        
        // Mientras haya notas que programar antes del tiempo de anticipación (incluyendo buffer adicional)
        while (this.nextNoteTime < currentTime + this.scheduleAheadTime + this.lookAheadBuffer) {
            // Si es la primera nota o después de una pausa, guardar tiempo esperado
            if (this.expectedNextNoteTime <= 0) {
                this.expectedNextNoteTime = this.nextNoteTime;
            } else {
                // Calcular desviación entre tiempo real y esperado
                const deviation = this.nextNoteTime - this.expectedNextNoteTime;
                
                // Registrar desviación en el historial
                this.recordTimingDeviation(deviation);
                
                // Aplicar corrección si la desviación supera el umbral
                if (Math.abs(deviation) > this.stabilityThreshold) {
                    // Calcular corrección (50% de la desviación para evitar sobre-corrección)
                    this.timeCorrection -= (deviation * 0.5);
                    
                    // Aplicar la corrección al tiempo de la nota
                    this.nextNoteTime = this.expectedNextNoteTime + this.timeCorrection;
                }
            }
            
            this.playSound(this.nextNoteTime);
            this.triggerVisualFeedback(this.nextNoteTime);
            
            // Calcular tiempo para la siguiente nota
            const secondsPerBeat = 60.0 / this.tempo;
            this.nextNoteTime += secondsPerBeat;
            this.expectedNextNoteTime += secondsPerBeat;
        }
        
        // Configurar el próximo llamado a scheduler (intervalo más corto para mayor precisión)
        this.timerID = setTimeout(() => this.scheduler(), 20);
    }
    
    // Registrar desviación en el historial y calcular corrección adaptativa
    recordTimingDeviation(deviation) {
        // Añadir desviación al historial
        this.timingHistory.push(deviation);
        
        // Mantener el historial dentro del límite
        if (this.timingHistory.length > this.maxTimingHistory) {
            this.timingHistory.shift();
        }
        
        // Si hay suficiente historial, analizar tendencia
        if (this.timingHistory.length >= 3) {
            // Calcular tendencia (promedio de las últimas desviaciones)
            const recentDeviations = this.timingHistory.slice(-3);
            const avgDeviation = recentDeviations.reduce((sum, val) => sum + val, 0) / recentDeviations.length;
            
            // Si hay una tendencia consistente, ajustar la corrección global
            if (Math.abs(avgDeviation) > this.stabilityThreshold / 2) {
                // Ajuste sutil para evitar oscilaciones
                this.timeCorrection -= (avgDeviation * 0.1);
            }
        }
    }
    
    async start() {
        try {
            // Reactivar contexto de audio si está suspendido
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            this.isPlaying = true;
            this.startStopBtn.innerHTML = '<i class="fas fa-stop"></i>';
            
            // Inicializar el tiempo para la primera nota (con un pequeño retraso para permitir la inicialización)
            this.nextNoteTime = this.audioContext.currentTime + 0.05;
            
            // Reiniciar mecanismo de corrección temporal
            this.resetTimingCorrection();
            
            // Iniciar el programador
            this.scheduler();
            
            // Añadir feedback visual cuando suena
            this.startVisualFeedback();
            
            // Activar el wake lock para evitar que la pantalla se apague
            await this.requestWakeLock();
        } catch (err) {
            console.error('Error al iniciar el metrónomo:', err);
        }
    }
    
    // Reiniciar el mecanismo de corrección temporal
    resetTimingCorrection() {
        this.expectedNextNoteTime = 0;
        this.timeCorrection = 0;
        this.timingHistory = [];
    }

    stop() {
        this.isPlaying = false;
        this.startStopBtn.innerHTML = '<i class="fas fa-play"></i>';
        
        // Detener el programador
        clearTimeout(this.timerID);
        this.timerID = null;
        
        // Detener feedback visual
        this.stopVisualFeedback();
        
        // Liberar el wake lock
        this.releaseWakeLock();
    }
    
    triggerVisualFeedback(time) {
        // Calcular el tiempo de espera hasta que se reproduzca la nota
        const waitTime = (time - this.audioContext.currentTime) * 1000;
        
        // Programar el efecto visual para que coincida con la reproducción de audio
        setTimeout(() => {
            if (this.pulseElement) {
                // Reiniciar la animación
                this.pulseElement.style.animation = 'none';
                this.pulseElement.offsetHeight; // Forzar repintado
                this.pulseElement.style.animation = `pulse ${60 / this.tempo}s ease-in-out infinite`;
                this.pulseElement.style.opacity = '0.7';
            }
        }, waitTime);
    }
    
    startVisualFeedback() {
        // Crear elemento pulsante si no existe
        if (!this.pulseElement) {
            this.pulseElement = document.createElement('div');
            this.pulseElement.className = 'pulse-animation';
            document.querySelector('.tempo-container').appendChild(this.pulseElement);
            
            // Añadir estilo para la animación
            const style = document.createElement('style');
            style.textContent = `
                .pulse-animation {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 150px;
                    height: 150px;
                    border-radius: 50%;
                    background: rgba(58, 110, 165, 0.2);
                    opacity: 0;
                    pointer-events: none;
                    z-index: -1;
                }
                
                @keyframes pulse {
                    0% { transform: translate(-50%, -50%) scale(0.95); opacity: 0.7; }
                    100% { transform: translate(-50%, -50%) scale(1.1); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Configurar velocidad de animación basada en el tempo
        const animationDuration = 60 / this.tempo;
        this.pulseElement.style.animation = `pulse ${animationDuration}s ease-in-out infinite`;
        this.pulseElement.style.display = 'block';
    }
    
    stopVisualFeedback() {
        if (this.pulseElement) {
            this.pulseElement.style.display = 'none';
        }
    }

    addSong() {
        const name = this.songNameInput.value.trim();
        // Usar el BPM actual si no se especifica uno
        let bpm = parseInt(this.songBpmInput.value);
        
        // Si el nombre existe pero el BPM no es válido, usar el BPM actual
        if (name) {
            if (!bpm || isNaN(bpm) || bpm < 40 || bpm > 208) {
                bpm = this.tempo;
                
                // Mostrar una pequeña notificación de que se usó el BPM actual
                this.showBpmNotification();
            }
            
            const song = { name, bpm };
            this.songs.push(song);
            this.saveSongs();
            this.renderSongs();
            
            // Clear inputs
            this.songNameInput.value = '';
            this.songBpmInput.value = '';
        }
    }
    
    showBpmNotification() {
        // Crear una pequeña notificación sobre el input de BPM
        const notification = document.createElement('div');
        notification.className = 'bpm-used-notification';
        notification.textContent = `Se usó el BPM actual: ${this.tempo}`;
        
        // Posicionar cerca del formulario
        const formContainer = this.addSongBtn.parentElement;
        formContainer.appendChild(notification);
        
        // Mostrar con animación
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Ocultar después de 2 segundos
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                formContainer.removeChild(notification);
            }, 300);
        }, 2000);
    }

    saveSongs() {
        localStorage.setItem('songs', JSON.stringify(this.songs));
        
        // Si hay un modal de compartir abierto, actualizar la URL
        if (document.querySelector('.share-modal.active')) {
            this.updateShareUrl();
        }
    }
    
    // Métodos para compartir lista
    loadSongsFromHash() {
        if (window.location.hash) {
            try {
                const encodedData = window.location.hash.slice(1); // Quita el '#'
                const decodedData = decodeURIComponent(encodedData);
                const jsonData = atob(decodedData); // Decodificar Base64
                const songs = JSON.parse(jsonData);
                
                // Verificar que es un array válido
                if (Array.isArray(songs) && songs.length > 0) {
                    // Mostrar notificación de lista cargada
                    this.showImportNotification(songs.length);
                    return songs;
                }
            } catch (error) {
                console.error("Error al cargar canciones desde URL:", error);
            }
        }
        return null;
    }
    
    showImportNotification(count) {
        // Crear notificación de importación
        const notification = document.createElement('div');
        notification.className = 'import-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-check-circle"></i>
                <span>Se ha cargado una lista compartida con ${count} temas.</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Mostrar la notificación con animación
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // Ocultar después de 5 segundos
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 5000);
    }
    
    generateShareUrl() {
        // Convertir la lista de canciones a JSON
        const jsonData = JSON.stringify(this.songs);
        
        // Codificar en Base64 para acortar y evitar problemas con caracteres especiales
        const encodedData = btoa(jsonData);
        
        // Generar la URL completa con el hash
        const baseUrl = window.location.href.split('#')[0];
        return `${baseUrl}#${encodeURIComponent(encodedData)}`;
    }
    
    showShareModal() {
        const shareModal = document.getElementById('share-modal');
        if (shareModal) {
            // Actualizar la URL de compartir
            this.updateShareUrl();
            
            // Mostrar el modal
            shareModal.classList.add('active');
            
            // Añadir evento para cerrar con Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.hideShareModal();
                }
            });
            
            // Añadir evento para cerrar al hacer clic fuera del modal
            shareModal.addEventListener('click', (e) => {
                if (e.target === shareModal) {
                    this.hideShareModal();
                }
            });
        }
    }
    
    hideShareModal() {
        const shareModal = document.getElementById('share-modal');
        if (shareModal) {
            shareModal.classList.remove('active');
        }
    }
    
    updateShareUrl() {
        const shareUrlInput = document.getElementById('share-url');
        if (shareUrlInput) {
            shareUrlInput.value = this.generateShareUrl();
        }
    }
    
    copyShareUrl() {
        const shareUrlInput = document.getElementById('share-url');
        if (shareUrlInput) {
            // Seleccionar el texto
            shareUrlInput.select();
            shareUrlInput.setSelectionRange(0, 99999); // Para dispositivos móviles
            
            // Copiar al portapapeles
            navigator.clipboard.writeText(shareUrlInput.value)
                .then(() => {
                    // Mostrar mensaje de copiado
                    const copyMessage = document.getElementById('copy-message');
                    if (copyMessage) {
                        copyMessage.classList.add('show');
                        
                        // Ocultar después de 2 segundos
                        setTimeout(() => {
                            copyMessage.classList.remove('show');
                        }, 2000);
                    }
                })
                .catch(err => {
                    console.error('Error al copiar al portapapeles:', err);
                    // Fallback para navegadores que no soportan clipboard API
                    document.execCommand('copy');
                });
        }
    }
    
    shareViaWhatsApp() {
        const shareUrl = encodeURIComponent(this.generateShareUrl());
        const message = encodeURIComponent('¡Mira mi lista de temas para el metrónomo!');
        const whatsappUrl = `https://wa.me/?text=${message}%20${shareUrl}`;
        window.open(whatsappUrl, '_blank');
    }
    
    shareViaEmail() {
        const shareUrl = this.generateShareUrl();
        const subject = encodeURIComponent('Mi lista de temas para el metrónomo');
        const body = encodeURIComponent(`¡Hola! Aquí te comparto mi lista de temas para el metrónomo:\n\n${shareUrl}`);
        const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;
        window.location.href = mailtoUrl;
    }

    renderSongs() {
        this.songsList.innerHTML = '';
        
        // Mostrar mensaje si no hay canciones
        if (this.songs.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.textContent = 'Aún no has agregado ningún tema.';
            emptyMessage.className = 'empty-list-message';
            this.songsList.appendChild(emptyMessage);
            return;
        }
        
        // Crear lista de canciones
        this.songs.forEach((song, index) => {
            const li = document.createElement('li');
            li.setAttribute('data-id', index);
            li.className = 'song-item';
            li.innerHTML = `
                <div class="song-drag-handle"><i class="fas fa-grip-lines"></i></div>
                <div class="song-info">
                    <span class="song-name" data-index="${index}">${song.name}</span>
                    <span class="song-bpm" data-index="${index}">${song.bpm} BPM</span>
                </div>
                <div class="song-controls">
                    <button class="edit-btn" onclick="metronome.editSong(${index})"><i class="fas fa-edit"></i></button>
                    <button onclick="metronome.loadSong(${index})"><i class="fas fa-play"></i></button>
                    <button class="delete-btn" onclick="metronome.deleteSong(${index})"><i class="fas fa-trash"></i></button>
                </div>
            `;
            this.songsList.appendChild(li);
        });
        
        // Inicializar drag and drop
        if (!this.sortable) {
            this.sortable = new Sortable(this.songsList, {
                animation: 150,
                handle: '.song-drag-handle',
                ghostClass: 'sortable-ghost',
                onEnd: (evt) => {
                    // Reordenar canciones según nuevo orden
                    const oldIndex = evt.oldIndex;
                    const newIndex = evt.newIndex;
                    
                    if (oldIndex !== newIndex) {
                        // Mover el elemento en el array
                        const movedItem = this.songs.splice(oldIndex, 1)[0];
                        this.songs.splice(newIndex, 0, movedItem);
                        
                        // Guardar el nuevo orden
                        this.saveSongs();
                        this.renderSongs();
                    }
                }
            });
        }
        
        // Hacer los nombres y BPM editables con doble clic
        const songNames = document.querySelectorAll('.song-name');
        const songBpms = document.querySelectorAll('.song-bpm');
        
        songNames.forEach(name => {
            name.addEventListener('dblclick', this.makeEditable.bind(this));
        });
        
        songBpms.forEach(bpm => {
            bpm.addEventListener('dblclick', this.makeEditable.bind(this));
        });
    }
    
    makeEditable(event) {
        const element = event.target;
        const index = element.getAttribute('data-index');
        const isName = element.classList.contains('song-name');
        const originalText = element.textContent;
        
        // Crear campo de edición
        const input = document.createElement(isName ? 'input' : 'number');
        input.type = isName ? 'text' : 'number';
        input.value = isName ? originalText : originalText.replace(' BPM', '');
        input.className = 'inline-edit';
        if (!isName) {
            input.min = 40;
            input.max = 208;
        }
        
        // Reemplazar el texto con el campo de edición
        element.textContent = '';
        element.appendChild(input);
        input.focus();
        
        // Manejar la confirmación de la edición
        const confirmEdit = () => {
            let newValue = input.value.trim();
            
            if (isName) {
                if (newValue) {
                    this.songs[index].name = newValue;
                    element.textContent = newValue;
                } else {
                    element.textContent = originalText;
                }
            } else {
                let bpmValue = parseInt(newValue);
                if (bpmValue && bpmValue >= 40 && bpmValue <= 208) {
                    this.songs[index].bpm = bpmValue;
                    element.textContent = bpmValue + ' BPM';
                } else {
                    element.textContent = originalText;
                }
            }
            
            this.saveSongs();
        };
        
        // Eventos para confirmar la edición
        input.addEventListener('blur', confirmEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                confirmEdit();
            } else if (e.key === 'Escape') {
                element.textContent = originalText;
            }
        });
    }
    
    editSong(index) {
        // Mostrar diálogo de edición
        const song = this.songs[index];
        
        // Crear diálogo modal
        const modal = document.createElement('div');
        modal.className = 'edit-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Editar Tema</h3>
                    <button id="close-modal" class="close-btn"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="form-group">
                    <label for="edit-name">Nombre del tema</label>
                    <input type="text" id="edit-name" value="${song.name}" placeholder="Ej: Mi canción favorita">
                </div>
                
                <div class="form-group">
                    <label for="edit-bpm">BPM</label>
                    <div class="bpm-input-group">
                        <input type="number" id="edit-bpm" min="40" max="208" value="${song.bpm}">
                        <div class="bpm-buttons">
                            <button id="use-current-bpm" class="icon-btn" title="Usar BPM actual">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                            <button id="tap-tempo-btn" class="icon-btn" title="Tap Tempo">
                                <i class="fas fa-hand-pointer"></i>
                            </button>
                        </div>
                    </div>
                    <div class="bpm-slider-container">
                        <input type="range" id="edit-bpm-slider" min="40" max="208" value="${song.bpm}">
                    </div>
                    <div class="bpm-presets">
                        <button data-bpm="60">Lento</button>
                        <button data-bpm="90">Medio</button>
                        <button data-bpm="120">Moderado</button>
                        <button data-bpm="160">Rápido</button>
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button id="cancel-edit" class="secondary-btn"><i class="fas fa-times"></i> Cancelar</button>
                    <button id="save-edit" class="primary-btn"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Referencias a elementos DOM
        const bpmInput = document.getElementById('edit-bpm');
        const bpmSlider = document.getElementById('edit-bpm-slider');
        const useCurrentBpmBtn = document.getElementById('use-current-bpm');
        const bpmPresetBtns = document.querySelectorAll('.bpm-presets button');
        const tapTempoBtn = document.getElementById('tap-tempo-btn');
        
        // Sincronizar input y slider de BPM
        bpmInput.addEventListener('input', () => {
            if (bpmInput.value >= 40 && bpmInput.value <= 208) {
                bpmSlider.value = bpmInput.value;
            }
        });
        
        bpmSlider.addEventListener('input', () => {
            bpmInput.value = bpmSlider.value;
        });
        
        // Botón de usar BPM actual
        useCurrentBpmBtn.addEventListener('click', () => {
            const currentBpm = this.tempo;
            bpmInput.value = currentBpm;
            bpmSlider.value = currentBpm;
            bpmInput.classList.add('highlight-input');
            setTimeout(() => {
                bpmInput.classList.remove('highlight-input');
            }, 500);
        });
        
        // Botones de preset de BPM
        bpmPresetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const bpmValue = btn.getAttribute('data-bpm');
                bpmInput.value = bpmValue;
                bpmSlider.value = bpmValue;
                bpmInput.classList.add('highlight-input');
                setTimeout(() => {
                    bpmInput.classList.remove('highlight-input');
                }, 500);
            });
        });
        
        // Tap Tempo
        let tapTimes = [];
        let tapTimeout;
        
        tapTempoBtn.addEventListener('click', () => {
            const now = Date.now();
            
            // Limitar a los últimos 4 taps
            if (tapTimes.length >= 4) {
                tapTimes.shift();
            }
            
            tapTimes.push(now);
            
            // Cancelar el timeout anterior si existe
            if (tapTimeout) {
                clearTimeout(tapTimeout);
            }
            
            // Calcular BPM si hay suficientes taps
            if (tapTimes.length >= 2) {
                const intervals = [];
                for (let i = 1; i < tapTimes.length; i++) {
                    intervals.push(tapTimes[i] - tapTimes[i-1]);
                }
                
                // Promedio de intervalos
                const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
                
                // Convertir a BPM (60000 ms = 1 minuto)
                const calculatedBpm = Math.round(60000 / avgInterval);
                
                // Limitar al rango válido
                const finalBpm = Math.min(Math.max(calculatedBpm, 40), 208);
                
                bpmInput.value = finalBpm;
                bpmSlider.value = finalBpm;
                bpmInput.classList.add('highlight-input');
            }
            
            // Resetear después de 2 segundos sin tap
            tapTimeout = setTimeout(() => {
                tapTimes = [];
            }, 2000);
            
            // Efecto visual del botón
            tapTempoBtn.classList.add('tapped');
            setTimeout(() => {
                tapTempoBtn.classList.remove('tapped');
            }, 100);
        });
        
        // Manejar acciones del diálogo
        document.getElementById('close-modal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        document.getElementById('cancel-edit').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        document.getElementById('save-edit').addEventListener('click', () => {
            const newName = document.getElementById('edit-name').value.trim();
            const newBpm = parseInt(document.getElementById('edit-bpm').value);
            
            if (newName && newBpm && newBpm >= 40 && newBpm <= 208) {
                song.name = newName;
                song.bpm = newBpm;
                this.saveSongs();
                this.renderSongs();
            }
            
            document.body.removeChild(modal);
        });
        
        // Cerrar con Esc
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.querySelector('.edit-modal')) {
                document.body.removeChild(modal);
            }
        });
        
        // Centrar el input al abrir
        document.getElementById('edit-name').focus();
    }

    loadSong(index) {
        const song = this.songs[index];
        this.tempo = song.bpm;
        this.tempoSlider.value = this.tempo;
        this.bpmValue.textContent = this.tempo;
        
        // Con Web Audio API, cambiar el tempo no requiere reiniciar
        // El nuevo tempo se aplicará en la siguiente nota programada
    }

    deleteSong(index) {
        this.songs.splice(index, 1);
        this.saveSongs();
        this.renderSongs();
    }
}

const metronome = new Metronome();
