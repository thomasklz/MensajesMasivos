/*
 * ============================
 * SISTEMA WHATSAPP MASIVO - JS
 * ============================
 */

// Configuración CSRF para Laravel
$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
    }
});

// ============================
// VARIABLES GLOBALES
// ============================

let loadedContacts = [];
let isWhatsAppReady = false;
let isProcessing = false;
let isPaused = false;
let shouldStop = false;
let currentBatch = 0;
let processedMessages = 0;
let successfulMessages = 0;
let failedMessages = 0;
let allResults = [];
let startTime = null;
let totalBatches = 0;

// Configuración del sistema
const CONFIG = {
    maxContactsPerFile: 10000,
    defaultBatchSize: 100,
    defaultDelayBetweenMessages: 2,
    defaultDelayBetweenBatches: 10,
    maxRetries: 3,
    connectionCheckInterval: 30000,
    progressUpdateInterval: 1000
};

// ============================
// FUNCIONES DE CONEXIÓN
// ============================

function checkConnectionStatus() {
    if (isProcessing) return;
    
    $.get('/whatsapp/status')
        .done(function(data) {
            isWhatsAppReady = data.ready;
            updateConnectionDisplay(data.ready);
            updateBulkButton();
        })
        .fail(function(xhr) {
            isWhatsAppReady = false;
            updateConnectionDisplay(false, 'Error de conexión con el servidor');
            updateBulkButton();
            
            if (!window.connectionErrorShown) {
                window.connectionErrorShown = true;
                Swal.fire({
                    icon: 'error',
                    title: 'Sin Conexión',
                    text: 'No se puede conectar con la API de WhatsApp. Verifica que esté ejecutándose.',
                    timer: 3000,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                setTimeout(() => { window.connectionErrorShown = false; }, 60000);
            }
        });
}

function updateConnectionDisplay(isReady, errorMessage = '') {
    const statusElement = $('#connection-status');
    
    if (isReady) {
        statusElement.html(`
            <span class="status-indicator status-connected"></span>
            Conectado y listo
        `).removeClass('bg-light text-dark').addClass('bg-success text-white');
        
        if (!window.connectionNotified) {
            window.connectionNotified = true;
            Swal.fire({
                icon: 'success',
                title: 'WhatsApp Conectado',
                text: 'La conexión con WhatsApp está activa y lista',
                timer: 2000,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    } else {
        statusElement.html(`
            <span class="status-indicator status-disconnected"></span>
            ${errorMessage || 'Desconectado - Verificar código QR'}
        `).removeClass('bg-success text-white').addClass('bg-light text-dark');
        window.connectionNotified = false;
    }
}

// ============================
// FUNCIONES DE VALIDACIÓN
// ============================

function updateBulkButton() {
    const btn = $('#sendBulkBtn');
    const hasContacts = loadedContacts.length > 0;
    const hasMessage = $('#messageTemplate').val().trim().length > 0;
    
    if (isWhatsAppReady && hasContacts && hasMessage && !isProcessing) {
        btn.prop('disabled', false)
           .removeClass('btn-secondary')
           .addClass('btn-success')
           .html('<i class="fas fa-rocket me-2"></i>Iniciar Envío Masivo');
    } else {
        btn.prop('disabled', true)
           .removeClass('btn-success')
           .addClass('btn-secondary');
        
        let reason = '';
        if (isProcessing) {
            reason = 'Procesando...';
        } else if (!isWhatsAppReady) {
            reason = 'WhatsApp no conectado';
        } else if (!hasContacts) {
            reason = 'Cargar archivo Excel';
        } else if (!hasMessage) {
            reason = 'Escribir mensaje';
        }
        
        btn.html(`<i class="fas fa-ban me-2"></i>${reason}`);
    }
}

// ============================
// MENSAJE INDIVIDUAL
// ============================

function initializeSingleMessage() {
    $('#singleMessageForm').submit(function(e) {
        e.preventDefault();
        
        const btn = $('#sendSingleBtn');
        const originalText = btn.html();
        btn.prop('disabled', true).html('<div class="custom-spinner"></div>Enviando...');
        
        // Crear objeto de contacto para procesamiento de variables
        const contact = {
            name: $('#singleContactName').val() || 'Cliente',
            phone: $('#phone').val(),
            value: $('#singleContactValue').val() || ''
        };
        
        // Procesar mensaje con variables dinámicas
        const rawMessage = $('#message').val();
        const processedMessage = processMessageWithVariables(rawMessage, contact);
        
        $.post('/whatsapp/send-single', {
            phone: contact.phone,
            message: processedMessage
        })
        .done(function(data) {
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Mensaje Enviado!',
                    html: `
                        <div class="text-start">
                            <p><strong>Para:</strong> ${contact.name} (${contact.phone})</p>
                            <p><strong>Mensaje procesado enviado correctamente</strong></p>
                            ${rawMessage !== processedMessage ? '<small class="text-muted">Variables reemplazadas automáticamente</small>' : ''}
                        </div>
                    `,
                    timer: 3000,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                
                // Limpiar formulario opcionalmente
                const shouldClear = localStorage.getItem('auto_clear_single') !== 'false';
                if (shouldClear) {
                    $('#phone, #singleContactName, #singleContactValue').val('');
                    updateSingleMessagePreview();
                }
                updateCharCount();
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error al Enviar',
                    text: data.message,
                    confirmButtonText: 'Entendido'
                });
            }
        })
        .fail(function(xhr) {
            let errorMessage = 'Error de conexión con el servidor';
            try {
                const response = JSON.parse(xhr.responseText);
                errorMessage = response.message || errorMessage;
            } catch (e) {
                // Mantener mensaje por defecto
            }
            
            Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: errorMessage,
                confirmButtonText: 'Reintentar'
            });
        })
        .always(function() {
            btn.prop('disabled', false).html(originalText);
        });
    });

    // Contador de caracteres para mensaje individual
    $('#message').on('input', updateCharCount);
    
    // Inicializar plantillas para mensaje individual
    initializeSingleMessageTemplates();
}
function updateCharCount() {
    const currentLength = $('#message').val().length;
    $('#charCount').text(`${currentLength}/4000`);
    
    if (currentLength > 3500) {
        $('#charCount').addClass('text-warning');
    } else if (currentLength > 3800) {
        $('#charCount').addClass('text-danger').removeClass('text-warning');
    } else {
        $('#charCount').removeClass('text-warning text-danger');
    }
}

// ============================
// CARGA DE EXCEL
// ============================

function initializeExcelUpload() {
    $('#excelUploadForm').submit(function(e) {
        e.preventDefault();
        
        const btn = $('#uploadBtn');
        const originalText = btn.html();
        btn.prop('disabled', true).html('<div class="custom-spinner"></div>Procesando archivo...');
        
        const formData = new FormData();
        formData.append('excel_file', $('#excel_file')[0].files[0]);
        
        $.ajax({
            url: '/whatsapp/upload-excel',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            timeout: 120000, // 2 minutos
            success: function(data) {
                if (data.success) {
                    loadedContacts = data.contacts;
                    
                    if (loadedContacts.length > CONFIG.maxContactsPerFile) {
                        Swal.fire({
                            icon: 'warning',
                            title: 'Archivo Muy Grande',
                            text: `El archivo tiene ${loadedContacts.length} contactos. Se procesarán solo los primeros ${CONFIG.maxContactsPerFile} para optimizar el rendimiento.`,
                            confirmButtonText: 'Entendido'
                        });
                        loadedContacts = loadedContacts.slice(0, CONFIG.maxContactsPerFile);
                    }
                    
                    displayContacts(loadedContacts);
                    calculateBatches();
                    updateBulkButton();
                    $('#batchControls').slideDown();
                    
                    Swal.fire({
                        icon: 'success',
                        title: '¡Archivo Procesado!',
                        html: `
                            <div class="text-start">
                                <p><strong>Contactos cargados:</strong> ${loadedContacts.length}</p>
                                <p><strong>Filas omitidas:</strong> ${data.skipped}</p>
                                <p><strong>Lotes generados:</strong> ${Math.ceil(loadedContacts.length / CONFIG.defaultBatchSize)}</p>
                            </div>
                        `,
                        timer: 4000,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error Procesando Excel',
                        text: data.message,
                        confirmButtonText: 'Entendido'
                    });
                    loadedContacts = [];
                    $('#batchControls').slideUp();
                    updateBulkButton();
                }
            },
            error: function(xhr, status, error) {
                let errorMessage = 'Error procesando el archivo Excel';
                
                if (status === 'timeout') {
                    errorMessage = 'El archivo tardó mucho en procesarse. Intenta con un archivo más pequeño.';
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Procesamiento',
                    text: errorMessage,
                    confirmButtonText: 'Entendido'
                });
                
                loadedContacts = [];
                $('#batchControls').slideUp();
                updateBulkButton();
            }
        }).always(function() {
            btn.prop('disabled', false).html(originalText);
        });
    });
}

// ============================
// VISUALIZACIÓN DE CONTACTOS
// ============================

function displayContacts(contacts) {
    $('#contactsCount').text(contacts.length);
    
    let html = '';
    const previewLimit = 10;
    contacts.slice(0, previewLimit).forEach(function(contact, index) {
        html += `
            <div class="border-bottom py-2 d-flex justify-content-between align-items-center">
                <div>
                    <strong class="text-primary">${contact.name}</strong>
                    <div class="text-muted small">${contact.phone}</div>
                </div>
                <div>
                    ${contact.value ? `<span class="badge bg-info">${contact.value}</span>` : ''}
                </div>
            </div>
        `;
    });
    
    if (contacts.length > previewLimit) {
        html += `
            <div class="text-center text-muted mt-3 py-2">
                <i class="fas fa-ellipsis-h me-2"></i>
                y ${contacts.length - previewLimit} contactos más
            </div>
        `;
    }
    
    $('#contactsList').html(html);
    $('#contactsPreview').slideDown();
}

// ============================
// CÁLCULOS DE LOTES
// ============================

function calculateBatches() {
    const batchSize = parseInt($('#batchSize').val()) || CONFIG.defaultBatchSize;
    totalBatches = Math.ceil(loadedContacts.length / batchSize);
    $('#batchesCount').text(totalBatches);
    updateTimeEstimate();
}

function updateTimeEstimate() {
    const batchSize = parseInt($('#batchSize').val()) || CONFIG.defaultBatchSize;
    const delayBetweenMessages = parseInt($('#delayBetweenMessages').val()) || CONFIG.defaultDelayBetweenMessages;
    const delayBetweenBatches = parseInt($('#delayBetweenBatches').val()) || CONFIG.defaultDelayBetweenBatches;
    
    if (loadedContacts.length === 0) {
        $('#estimatedTime').text('Carga contactos primero');
        return;
    }
    
    const totalMessages = loadedContacts.length;
    const numBatches = Math.ceil(totalMessages / batchSize);
    
    // Cálculo: (mensajes × delay) + (lotes × delay entre lotes) + tiempo de procesamiento
    const totalTimeSeconds = (totalMessages * delayBetweenMessages) + (numBatches * delayBetweenBatches) + (totalMessages * 1);
    
    const hours = Math.floor(totalTimeSeconds / 3600);
    const minutes = Math.floor((totalTimeSeconds % 3600) / 60);
    
    let estimateText = '';
    if (hours > 0) {
        estimateText = `${hours}h ${minutes}m`;
    } else {
        estimateText = `${minutes}m`;
    }
    
    $('#estimatedTime').text(estimateText);
}

// ============================
// ENVÍO MASIVO
// ============================

function initializeBulkSending() {
    $('#sendBulkBtn').click(function() {
        if (loadedContacts.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin Contactos',
                text: 'Primero debes cargar un archivo Excel con contactos',
                confirmButtonText: 'Entendido'
            });
            return;
        }

        const batchSize = parseInt($('#batchSize').val());
        const estimatedTime = $('#estimatedTime').text();
        
        Swal.fire({
            icon: 'question',
            title: 'Confirmar Envío Masivo',
            html: `
                <div class="text-start">
                    <div class="alert alert-info">
                        <strong><i class="fas fa-info-circle me-2"></i>Configuración del Envío:</strong>
                    </div>
                    <ul class="list-unstyled">
                        <li><strong>📱 Contactos:</strong> ${loadedContacts.length}</li>
                        <li><strong>📦 Lotes:</strong> ${totalBatches} (${batchSize} mensajes/lote)</li>
                        <li><strong>⏱️ Tiempo estimado:</strong> ${estimatedTime}</li>
                        <li><strong>⏳ Delay entre mensajes:</strong> ${$('#delayBetweenMessages').val()}s</li>
                        <li><strong>⏸️ Delay entre lotes:</strong> ${$('#delayBetweenBatches').val()}s</li>
                        <li><strong>🔄 Auto-retry:</strong> ${$('#autoRetry').is(':checked') ? 'Activado' : 'Desactivado'}</li>
                    </ul>
                    <div class="alert alert-warning mt-3">
                        <small><i class="fas fa-exclamation-triangle me-1"></i>
                        Una vez iniciado, podrás pausar, reanudar o detener el proceso en cualquier momento.</small>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-rocket me-2"></i>Sí, Iniciar Envío',
            cancelButtonText: '<i class="fas fa-times me-2"></i>Cancelar',
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d',
            width: 700,
            customClass: {
                popup: 'swal-wide'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                startBulkSending();
            }
        });
    });
}

async function startBulkSending() {
    // Inicializar variables
    isProcessing = true;
    isPaused = false;
    shouldStop = false;
    currentBatch = 0;
    processedMessages = 0;
    successfulMessages = 0;
    failedMessages = 0;
    allResults = [];
    startTime = new Date();
    
    // Configuración
    const batchSize = parseInt($('#batchSize').val());
    const delayBetweenMessages = parseInt($('#delayBetweenMessages').val()) * 1000;
    const delayBetweenBatches = parseInt($('#delayBetweenBatches').val()) * 1000;
    
    // Actualizar UI
    updateBulkButton();
    showProcessingControls();
    $('#advancedProgress').slideDown();
    updateConnectionDisplay(true, 'Procesando envío masivo...');
    
    // Mostrar ficación de inicio (NO modal)
    Swal.fire({
        icon: 'info',
        title: 'Envío Iniciado',
        text: `Iniciando envío de ${loadedContacts.length} mensajes...`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });

    try {
        // Dividir contactos en lotes
        const batches = [];
        for (let i = 0; i < loadedContacts.length; i += batchSize) {
            batches.push(loadedContacts.slice(i, i + batchSize));
        }
        
        // Inicializar progreso
        totalBatches = batches.length;
        updateProgress();
        
        // Procesar cada lote
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            if (shouldStop) break;
            
            currentBatch = batchIndex + 1;
            const batch = batches[batchIndex];
            
            updateCurrentBatchInfo(currentBatch, totalBatches, 0, batch.length);
            
            // Procesar mensajes del lote
            await processBatch(batch, delayBetweenMessages);
            
            // Delay entre lotes (excepto el último)
            if (batchIndex < batches.length - 1 && !shouldStop) {
                await sleep(delayBetweenBatches);
            }
            
            // Manejar pausa
            while (isPaused && !shouldStop) {
                await sleep(1000);
            }
        }
        
        finalizeBulkSending();
        
    } catch (error) {
        console.error('Error en envío masivo:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error Crítico',
            text: 'Ocurrió un error durante el envío masivo: ' + error.message,
            confirmButtonText: 'Entendido'
        });
        finalizeBulkSending();
    }
}

async function processBatch(batch, delayBetweenMessages) {
    for (let i = 0; i < batch.length; i++) {
        if (shouldStop) break;
        
        const contact = batch[i];
        
        try {
            // Personalizar mensaje
            const personalizedMessage = $('#messageTemplate').val()
                .replace(/{nombre}/g, contact.name)
                .replace(/{valor}/g, contact.value || '');
            
            // Enviar mensaje
            const result = await sendSingleMessageInternal(contact, personalizedMessage);
            
            allResults.push(result);
            
            if (result.success) {
                successfulMessages++;
            } else {
                failedMessages++;
            }
            
            processedMessages++;
            
            // Actualizar progreso
            updateProgress();
            updateCurrentBatchInfo(currentBatch, totalBatches, i + 1, batch.length);
            updateRealTimeStats();
            
            // Delay entre mensajes (excepto el último del lote)
            if (i < batch.length - 1 && !shouldStop) {
                await sleep(delayBetweenMessages);
            }
            
            // Manejar pausa
            while (isPaused && !shouldStop) {
                await sleep(1000);
            }
            
        } catch (error) {
            console.error('Error procesando contacto:', error);
            
            allResults.push({
                name: contact.name,
                phone: contact.phone,
                success: false,
                message: 'Error interno: ' + error.message,
                attempts: 1
            });
            
            failedMessages++;
            processedMessages++;
        }
    }
}

async function sendSingleMessageInternal(contact, message) {
    try {
        const response = await $.post('/whatsapp/send-single', {
            phone: contact.phone,
            message: message
        });
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: response.success,
            message: response.success ? 'Enviado correctamente' : response.message,
            attempts: 1
        };
        
    } catch (xhr) {
        let errorMessage = 'Error de conexión';
        try {
            const response = JSON.parse(xhr.responseText);
            errorMessage = response.message || errorMessage;
        } catch (e) {
            // Mantener mensaje por defecto
        }
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: false,
            message: errorMessage,
            attempts: 1
        };
    }
}

// ============================
// ACTUALIZACIONES DE PROGRESO
// ============================

function updateProgress() {
    const percentage = loadedContacts.length > 0 ? (processedMessages / loadedContacts.length) * 100 : 0;
    $('.progress-bar-advanced').css('width', percentage + '%').text(Math.round(percentage) + '%');
    $('#overallProgress').text(`${processedMessages} / ${loadedContacts.length}`);
    
    // Actualizar el texto de progreso de lote
    $('#batchProgress').html(`<small class="text-muted">Procesando lote ${currentBatch} de ${totalBatches}...</small>`);
    
    // Actualizar tiempo transcurrido
    if (startTime) {
        const elapsed = new Date() - startTime;
        $('#elapsedTime').text(formatTime(elapsed));
        
        // Calcular tiempo estimado restante
        if (processedMessages > 0) {
            const avgTimePerMessage = elapsed / processedMessages;
            const remainingMessages = loadedContacts.length - processedMessages;
            const estimatedRemaining = remainingMessages * avgTimePerMessage;
            $('#estimatedTimeRemaining').text(formatTime(estimatedRemaining));
        }
    }
}

function updateCurrentBatchInfo(currentBatch, totalBatches, currentInBatch, totalInBatch) {
    $('#currentBatchNumber').text(currentBatch);
    $('#totalBatchNumber').text(totalBatches);
    $('#batchProgressText').text(`${currentInBatch}/${totalInBatch}`);
    $('#currentBatchInfo').show();
}

function updateRealTimeStats() {
    $('#liveSent').text(successfulMessages);
    $('#liveFailed').text(failedMessages);
    $('#currentBatch').text(currentBatch);
    $('#totalBatches').text(totalBatches);
    
    // Actualizar barra de progreso en stats
    const percentage = loadedContacts.length > 0 ? (processedMessages / loadedContacts.length) * 100 : 0;
    $('#liveProgressBar').css('width', percentage + '%');
    
    // Calcular velocidad
    if (startTime && processedMessages > 0) {
        const elapsed = (new Date() - startTime) / 1000;
        const messagesPerSecond = processedMessages / elapsed;
        const messagesPerMinute = messagesPerSecond * 60;
        
        let speedClass = 'speed-slow';
        let speedText = 'Lento';
        
        if (messagesPerMinute > 25) {
            speedClass = 'speed-fast';
            speedText = 'Rápido';
        } else if (messagesPerMinute > 15) {
            speedClass = 'speed-medium';
            speedText = 'Medio';
        }
        
        $('#liveSpeed').html(`<span class="speed-indicator ${speedClass}"></span>${speedText} (${messagesPerMinute.toFixed(1)}/min)`);
        
        // Calcular ETA
        if (processedMessages < loadedContacts.length) {
            const remainingMessages = loadedContacts.length - processedMessages;
            const etaSeconds = remainingMessages / messagesPerSecond;
            $('#liveETA').text(formatTime(etaSeconds * 1000));
        } else {
            $('#liveETA').text('Completado');
        }
    }
}

// ============================
// CONTROLES DE PROCESO
// ============================

function initializeProcessControls() {
    $('#pauseBtn').click(function() {
        isPaused = true;
        $(this).hide();
        $('#resumeBtn').show();
        
        Swal.fire({
            icon: 'info',
            title: 'Envío Pausado',
            text: 'El envío ha sido pausado. Puedes reanudarlo cuando quieras.',
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    });

    $('#resumeBtn').click(function() {
        isPaused = false;
        $(this).hide();
        $('#pauseBtn').show();
        
        Swal.fire({
            icon: 'success',
            title: 'Envío Reanudado',
            text: 'El envío continúa normalmente.',
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    });

    $('#stopBtn').click(function() {
        Swal.fire({
            icon: 'warning',
            title: '¿Detener Envío?',
            text: '¿Estás seguro de que quieres detener el envío? Los mensajes ya enviados no se pueden deshacer.',
            showCancelButton: true,
            confirmButtonText: 'Sí, Detener',
            cancelButtonText: 'Continuar',
            confirmButtonColor: '#dc3545'
        }).then((result) => {
            if (result.isConfirmed) {
                shouldStop = true;
                isPaused = false;
            }
        });
    });
}

function showProcessingControls() {
    $('#sendBulkBtn').hide();
    $('#pauseBtn, #stopBtn').show();
}

function hideProcessingControls() {
    $('#sendBulkBtn').show();
    $('#pauseBtn, #resumeBtn, #stopBtn').hide();
}

// ============================
// FINALIZACIÓN Y RESULTADOS
// ============================

function finalizeBulkSending() {
    isProcessing = false;
    hideProcessingControls();
    updateBulkButton();
    
    $('#advancedProgress').slideUp();
    $('#detailedResultsContainer').slideDown();
    
    // Actualizar estadísticas finales
    $('#finalTotalSent').text(successfulMessages);
    $('#finalTotalFailed').text(failedMessages);
    
    const successRate = loadedContacts.length > 0 ? ((successfulMessages / loadedContacts.length) * 100).toFixed(1) : 0;
    $('#successRate').text(successRate + '%');
    
    if (startTime) {
        const totalTime = new Date() - startTime;
        $('#totalDuration').text(formatTime(totalTime));
    }
    
    displayDetailedResults();
    
    // Alerta final
    if (shouldStop) {
        Swal.fire({
            icon: 'warning',
            title: 'Envío Detenido',
            html: `
                <div class="text-center">
                    <p>Proceso detenido por el usuario.</p>
                    <div class="row">
                        <div class="col-4">
                            <div class="text-success">
                                <strong>${successfulMessages}</strong><br>
                                <small>Enviados</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="text-danger">
                                <strong>${failedMessages}</strong><br>
                                <small>Fallidos</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="text-info">
                                <strong>${processedMessages}</strong><br>
                                <small>Procesados</small>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido'
        });
    } else if (successfulMessages === loadedContacts.length) {
        Swal.fire({
            icon: 'success',
            title: '¡Envío Completado con Éxito!',
            html: `
                <div class="text-center">
                    <div class="mb-3">
                        <i class="fas fa-check-circle fa-4x text-success"></i>
                    </div>
                    <p>Se enviaron <strong>${successfulMessages}</strong> mensajes exitosamente</p>
                    <p><small>Tasa de éxito: ${successRate}%</small></p>
                </div>
            `,
            confirmButtonText: 'Excelente'
        });
    } else {
        Swal.fire({
            icon: failedMessages > successfulMessages ? 'error' : 'warning',
            title: 'Envío Finalizado',
            html: `
                <div class="text-center">
                    <div class="row mb-3">
                        <div class="col-6">
                            <div class="text-success">
                                <i class="fas fa-check-circle fa-2x"></i>
                                <div><strong>${successfulMessages}</strong></div>
                                <div><small>Enviados</small></div>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="text-danger">
                                <i class="fas fa-times-circle fa-2x"></i>
                                <div><strong>${failedMessages}</strong></div>
                                <div><small>Fallidos</small></div>
                            </div>
                        </div>
                    </div>
                    <p><strong>Tasa de éxito:</strong> ${successRate}%</p>
                </div>
            `,
            confirmButtonText: 'Ver Detalles'
        });
    }
    
    // Restablecer estado de conexión
    checkConnectionStatus();
}

function displayDetailedResults() {
    let html = '';
    
    allResults.forEach(function(result, index) {
        const className = result.success ? 'result-success' : 'result-error';
        const icon = result.success ? 'fas fa-check' : 'fas fa-times';
        const attemptsText = result.attempts > 1 ? ` (${result.attempts} intentos)` : '';
        
        html += `
            <div class="result-item ${className}" data-success="${result.success}">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <i class="${icon} me-2"></i>
                        <strong>${result.name}</strong> 
                        <span class="text-muted">(${result.phone})</span>
                    </div>
                    <div class="text-end">
                        <span class="badge ${result.success ? 'bg-success' : 'bg-danger'}">
                            ${result.message}${attemptsText}
                        </span>
                    </div>
                </div>
            </div>
        `;
    });
    
    $('#detailedResults').html(html);
    
    // Event listeners para filtros
    $('input[name="resultFilter"]').change(function() {
        const filter = $(this).attr('id');
        const results = $('#detailedResults .result-item');
        
        results.show();
        
        if (filter === 'filterSuccess') {
            results.filter('[data-success="false"]').hide();
        } else if (filter === 'filterFailed') {
            results.filter('[data-success="true"]').hide();
        }
    });
}

// ============================
// FUNCIONES DE UTILIDAD
// ============================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// ============================
// STATS EN TIEMPO REAL
// ============================

function showRealTimeStats() {
    $('#realTimeStats').slideDown();
}

function hideRealTimeStats() {
    $('#realTimeStats').slideUp();
}

// ============================
// DESCARGAS
// ============================

function downloadSuccessfulContacts() {
    const successfulContacts = allResults.filter(r => r.success);
    downloadCSV(successfulContacts, 'contactos_exitosos.csv');
}

function downloadFailedContacts() {
    const failedContacts = allResults.filter(r => !r.success);
    downloadCSV(failedContacts, 'contactos_fallidos.csv');
}

function downloadCSV(data, filename) {
    if (data.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin Datos',
            text: 'No hay datos para descargar en esta categoría.',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    const csvContent = "data:text/csv;charset=utf-8," 
        + "Nombre,Teléfono,Estado,Mensaje,Intentos\n"
        + data.map(row => [
            `"${row.name}"`,
            row.phone,
            row.success ? 'Exitoso' : 'Fallido',
            `"${row.message}"`,
            row.attempts || 1
        ].join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    Swal.fire({
        icon: 'success',
        title: 'Descarga Iniciada',
        text: `El archivo ${filename} se está descargando.`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

// ============================
// INICIALIZACIÓN PRINCIPAL
// ============================

$(document).ready(function() {
    // Inicializar todos los módulos
    initializeSingleMessage();
    initializeExcelUpload();
    initializeBulkSending();
    initializeProcessControls();
    
    // Event listeners para configuración
    $('#batchSize, #delayBetweenMessages, #delayBetweenBatches').change(function() {
        calculateBatches();
    });
    
    $('#messageTemplate').on('input', function() {
        updateBulkButton();
        const length = $(this).val().length;
        $('#templateCharCount').text(`${length} caracteres`);
    });
    
    // Verificar conexión inicial
    checkConnectionStatus();
    setInterval(checkConnectionStatus, CONFIG.connectionCheckInterval);
    
    // Estado inicial
    updateBulkButton();
    updateCharCount();
    
    // Mensaje de bienvenida
    setTimeout(function() {
        Swal.fire({
            icon: 'info',
            title: 'Sistema WhatsApp Masivo',
            html: `
                <div class="text-center">
                    <i class="fab fa-whatsapp fa-3x text-success mb-3"></i>
                    <p>Sistema optimizado para envío de hasta <strong>10,000 mensajes</strong></p>
                    <p><small>Con procesamiento por lotes inteligente y recuperación automática de errores</small></p>
                </div>
            `,
            timer: 4000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }, 1000);
  
    
    // Actualizar plantillas cuando se cree/modifique una plantilla
    $(document).on('templateSaved templateUpdated', function() {
        loadTemplatesInSingleSelector();
    });
    
    // Configuración de auto-limpiar
    if (localStorage.getItem('auto_clear_single') === null) {
        localStorage.setItem('auto_clear_single', 'true');
    }
});

/*
 * ============================
 * PLANTILLAS DINÁMICAS - JAVASCRIPT ADICIONAL
 * ============================
 */

// AGREGAR AL FINAL DEL ARCHIVO whatsapp-system.js EXISTENTE

// ============================
// VARIABLES GLOBALES PARA PLANTILLAS
// ============================

let savedTemplates = [];
let selectedTemplate = null;
let currentEditingTemplate = null;

// Variables dinámicas disponibles
const AVAILABLE_VARIABLES = {
    '{nombre}': 'Nombre del contacto',
    '{valor}': 'Valor o monto',
    '{fecha}': 'Fecha actual',
    '{mes}': 'Mes actual',
    '{año}': 'Año actual',
    '{telefono}': 'Teléfono del contacto',
    '{empresa}': 'Nombre de la empresa',
    '{personalizado1}': 'Campo personalizado 1',
    '{personalizado2}': 'Campo personalizado 2'
};

// ============================
// FUNCIONES DE GESTIÓN DE PLANTILLAS
// ============================

function initializeTemplateSystem() {
    loadSavedTemplates();
    initializeTemplateEvents();
    initializeTemplatePreview();
    updateTemplateCounter();
}

function loadSavedTemplates() {
    // Cargar plantillas desde localStorage (en producción sería desde la base de datos)
    const stored = localStorage.getItem('whatsapp_templates');
    if (stored) {
        try {
            savedTemplates = JSON.parse(stored);
            displayTemplates();
        } catch (e) {
            console.error('Error cargando plantillas:', e);
            savedTemplates = [];
        }
    } else {
        // Plantillas por defecto
        savedTemplates = [
            {
                id: generateTemplateId(),
                name: 'Recordatorio de Pago',
                category: 'cobranza',
                content: '📢 *RECORDATORIO DE PAGO* 📢\n\nEstimad@ *{nombre}*,\n\nLe recordamos que tiene un saldo pendiente de *{valor}* correspondiente al mes de *{mes}*.\n\n*Fecha límite de pago:* {fecha}\n\n*Para mayor información contacte al +593 96 847 1674*\n\n¡Gracias por su atención! 😊',
                isDefault: true,
                createdAt: new Date().toISOString(),
                usageCount: 0
            },
            {
                id: generateTemplateId(),
                name: 'Promoción Especial',
                category: 'promociones',
                content: '🎉 *¡OFERTA ESPECIAL!* 🎉\n\nHola *{nombre}*,\n\nTenemos una promoción exclusiva para ti:\n*50% de descuento* en tu próximo pago\n\n*Válido hasta:* {fecha}\n*Tu ahorro sería:* {valor}\n\n¡No te lo pierdas!\n\n*{empresa}* 📱',
                isDefault: false,
                createdAt: new Date().toISOString(),
                usageCount: 0
            }
        ];
        saveTemplatesToStorage();
        displayTemplates();
    }
}

function saveTemplatesToStorage() {
    localStorage.setItem('whatsapp_templates', JSON.stringify(savedTemplates));
}

function generateTemplateId() {
    return 'tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================
// VISUALIZACIÓN DE PLANTILLAS
// ============================

function displayTemplates(filter = 'all') {
    const container = $('#templatesList');
    const filteredTemplates = filter === 'all' 
        ? savedTemplates 
        : savedTemplates.filter(t => t.category === filter);

    if (filteredTemplates.length === 0) {
        container.html(`
            <div class="empty-state">
                <i class="fas fa-file-alt"></i>
                <h5>No hay plantillas</h5>
                <p>${filter === 'all' ? 'No tienes plantillas guardadas aún' : 'No hay plantillas en esta categoría'}</p>
                <button class="btn btn-primary" onclick="$('#templates-tab').click()">
                    <i class="fas fa-plus me-2"></i>Crear Primera Plantilla
                </button>
            </div>
        `);
        return;
    }

    let html = '';
    filteredTemplates.forEach(template => {
        const isDefault = template.isDefault ? 'template-default' : '';
        const categoryClass = `category-${template.category}`;
        
        html += `
            <div class="template-item ${isDefault}" data-id="${template.id}" data-category="${template.category}">
                <div class="template-header">
                    <h6 class="template-name">${escapeHtml(template.name)}</h6>
                    <span class="template-category ${categoryClass}">${getCategoryName(template.category)}</span>
                </div>
                
                <div class="template-content-preview">${escapeHtml(template.content)}</div>
                
                <div class="template-meta">
                    <span><i class="fas fa-calendar-alt me-1"></i>${formatDate(template.createdAt)}</span>
                    <span><i class="fas fa-chart-bar me-1"></i>Usado ${template.usageCount || 0} veces</span>
                </div>
                
                <div class="template-floating-actions">
                    <button class="floating-btn edit" onclick="editTemplate('${template.id}')" 
                            title="Editar plantilla">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="floating-btn duplicate" onclick="duplicateTemplate('${template.id}')" 
                            title="Duplicar plantilla">
                        <i class="fas fa-copy"></i>
                    </button>
                    ${!template.isDefault ? `
                    <button class="floating-btn set-default" onclick="setAsDefault('${template.id}')" 
                            title="Establecer por defecto">
                        <i class="fas fa-star"></i>
                    </button>
                    ` : ''}
                    <button class="floating-btn delete" onclick="deleteTemplate('${template.id}')" 
                            title="Eliminar plantilla">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                
                <div class="template-char-count">${template.content.length} chars</div>
            </div>
        `;
    });

    container.html(html);
    updateTemplateCounter();
    
    // Agregar event listeners para selección
    $('.template-item').click(function(e) {
        if ($(e.target).closest('.template-floating-actions').length) return;
        
        $('.template-item').removeClass('selected');
        $(this).addClass('selected');
        selectedTemplate = $(this).data('id');
        
        const template = getTemplateById(selectedTemplate);
        if (template) {
            showTemplatePreview(template);
        }
    });
}

function updateTemplateCounter() {
    const total = savedTemplates.length;
    const byCategory = savedTemplates.reduce((acc, template) => {
        acc[template.category] = (acc[template.category] || 0) + 1;
        return acc;
    }, {});

    $('.templates-counter').html(`
        <strong>Total:</strong> ${total} plantillas |
        <strong>Cobranza:</strong> ${byCategory.cobranza || 0} |
        <strong>Promociones:</strong> ${byCategory.promociones || 0} |
        <strong>Informativo:</strong> ${byCategory.informativo || 0} |
        <strong>Soporte:</strong> ${byCategory.soporte || 0} |
        <strong>Otro:</strong> ${byCategory.otro || 0}
    `);
}

// ============================
// OPERACIONES CRUD DE PLANTILLAS
// ============================

function saveTemplate() {
    const form = $('#templateForm');
    const name = $('#templateName').val().trim();
    const category = $('#templateCategory').val();
    const content = $('#templateContent').val().trim();
    const isDefault = $('#templateDefault').is(':checked');

    if (!name || !content) {
        Swal.fire({
            icon: 'warning',
            title: 'Campos Requeridos',
            text: 'Por favor completa el nombre y contenido de la plantilla',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    // Si se marca como por defecto, quitar el flag de otras plantillas
    if (isDefault) {
        savedTemplates.forEach(t => t.isDefault = false);
    }

    const template = {
        id: currentEditingTemplate || generateTemplateId(),
        name: name,
        category: category,
        content: content,
        isDefault: isDefault,
        createdAt: currentEditingTemplate ? 
            getTemplateById(currentEditingTemplate).createdAt : 
            new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: currentEditingTemplate ? 
            getTemplateById(currentEditingTemplate).usageCount || 0 : 0
    };

    if (currentEditingTemplate) {
        // Actualizar plantilla existente
        const index = savedTemplates.findIndex(t => t.id === currentEditingTemplate);
        if (index !== -1) {
            savedTemplates[index] = template;
        }
        currentEditingTemplate = null;
    } else {
        // Nueva plantilla
        savedTemplates.unshift(template);
    }

    saveTemplatesToStorage();
    displayTemplates();
    form[0].reset();
    
    Swal.fire({
        icon: 'success',
        title: '¡Plantilla Guardada!',
        text: `La plantilla "${name}" se guardó correctamente`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

function editTemplate(templateId) {
    const template = getTemplateById(templateId);
    if (!template) return;

    currentEditingTemplate = templateId;
    
    $('#templateName').val(template.name);
    $('#templateCategory').val(template.category);
    $('#templateContent').val(template.content);
    $('#templateDefault').prop('checked', template.isDefault);
    
    $('#saveTemplateBtn').html('<i class="fas fa-save me-2"></i>Actualizar Plantilla');
    
    // Scroll al formulario
    $('html, body').animate({
        scrollTop: $('#templateForm').offset().top - 100
    }, 500);
    
    Swal.fire({
        icon: 'info',
        title: 'Modo Edición',
        text: `Editando la plantilla "${template.name}"`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

function duplicateTemplate(templateId) {
    const template = getTemplateById(templateId);
    if (!template) return;

    const newTemplate = {
        ...template,
        id: generateTemplateId(),
        name: template.name + ' (Copia)',
        isDefault: false,
        createdAt: new Date().toISOString(),
        usageCount: 0
    };

    savedTemplates.unshift(newTemplate);
    saveTemplatesToStorage();
    displayTemplates();
    
    Swal.fire({
        icon: 'success',
        title: 'Plantilla Duplicada',
        text: `Se creó una copia de "${template.name}"`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

function deleteTemplate(templateId) {
    const template = getTemplateById(templateId);
    if (!template) return;

    Swal.fire({
        icon: 'warning',
        title: '¿Eliminar Plantilla?',
        html: `¿Estás seguro de que quieres eliminar la plantilla <strong>"${template.name}"</strong>?<br><small class="text-muted">Esta acción no se puede deshacer</small>`,
        showCancelButton: true,
        confirmButtonText: 'Sí, Eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc3545'
    }).then((result) => {
        if (result.isConfirmed) {
            savedTemplates = savedTemplates.filter(t => t.id !== templateId);
            saveTemplatesToStorage();
            displayTemplates();
            
            Swal.fire({
                icon: 'success',
                title: 'Plantilla Eliminada',
                text: `La plantilla "${template.name}" fue eliminada`,
                timer: 2000,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    });
}

function setAsDefault(templateId) {
    // Quitar flag por defecto de todas las plantillas
    savedTemplates.forEach(t => t.isDefault = false);
    
    // Establecer la nueva plantilla por defecto
    const template = getTemplateById(templateId);
    if (template) {
        template.isDefault = true;
        saveTemplatesToStorage();
        displayTemplates();
        
        Swal.fire({
            icon: 'success',
            title: 'Plantilla por Defecto',
            text: `"${template.name}" es ahora la plantilla por defecto`,
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

// ============================
// VISTA PREVIA DE PLANTILLAS
// ============================

function initializeTemplatePreview() {
    updatePreviewTime();
    setInterval(updatePreviewTime, 60000); // Actualizar cada minuto
}

function showTemplatePreview(template) {
    if (!template) return;

    $('#templatePreviewSection').slideDown();
    renderTemplatePreview(template.content);
}

function renderTemplatePreview(templateContent) {
    if (!templateContent) {
        $('#previewContent').text('Selecciona una plantilla para ver la vista previa');
        return;
    }

    // Obtener valores de prueba
    const previewData = {
        nombre: $('#previewNombre').val() || 'Juan Pérez',
        valor: $('#previewValor').val() || '$45.50',
        telefono: $('#previewTelefono').val() || '593998765432',
        empresa: $('#previewEmpresa').val() || 'La SIMPAR',
        personalizado1: $('#previewPersonalizado1').val() || '',
        personalizado2: $('#previewPersonalizado2').val() || '',
        fecha: new Date().toLocaleDateString('es-ES'),
        mes: new Date().toLocaleDateString('es-ES', { month: 'long' }).toUpperCase(),
        año: new Date().getFullYear()
    };

    // Reemplazar variables
    let renderedContent = templateContent;
    Object.keys(previewData).forEach(key => {
        const regex = new RegExp(`{${key}}`, 'g');
        renderedContent = renderedContent.replace(regex, previewData[key]);
    });

    // Convertir a HTML para WhatsApp (negrita, cursiva, etc.)
    renderedContent = formatWhatsAppText(renderedContent);
    
    $('#previewContent').html(renderedContent);
}

function formatWhatsAppText(text) {
    return text
        .replace(/\*([^*]+)\*/g, '<strong>$1</strong>') // *negrita*
        .replace(/_([^_]+)_/g, '<em>$1</em>') // _cursiva_
        .replace(/~([^~]+)~/g, '<del>$1</del>') // ~tachado~
        .replace(/```([^`]+)```/g, '<code>$1</code>') // ```código```
        .replace(/\n/g, '<br>'); // saltos de línea
}

function updatePreviewTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    $('#previewTime').text(timeString);
}

// ============================
// INTEGRACIÓN CON ENVÍO MASIVO
// ============================

function loadTemplateIntoMessage() {
    const template = getTemplateById(selectedTemplate);
    if (!template) {
        Swal.fire({
            icon: 'warning',
            title: 'Sin Selección',
            text: 'Por favor selecciona una plantilla primero',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    $('#messageTemplate').val(template.content);
    updateBulkButton();
    
    // Incrementar contador de uso
    template.usageCount = (template.usageCount || 0) + 1;
    saveTemplatesToStorage();
    
    Swal.fire({
        icon: 'success',
        title: 'Plantilla Cargada',
        text: `La plantilla "${template.name}" se cargó en el editor`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
    
    // Cambiar a la pestaña de envío masivo
    $('#bulk-tab').click();
}

function saveCurrentMessageAsTemplate() {
    const content = $('#messageTemplate').val().trim();
    if (!content) {
        Swal.fire({
            icon: 'warning',
            title: 'Sin Contenido',
            text: 'Escribe un mensaje antes de guardarlo como plantilla',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    // Mostrar modal para guardar
    $('#saveTemplateModal').modal('show');
}

// ============================
// EVENT LISTENERS
// ============================

function initializeTemplateEvents() {
    // Formulario principal de plantillas
    $('#templateForm').submit(function(e) {
        e.preventDefault();
        saveTemplate();
    });

    // Vista previa
    $('#previewTemplateBtn').click(function() {
        const content = $('#templateContent').val();
        if (content.trim()) {
            renderTemplatePreview(content);
            $('#templatePreviewSection').slideDown();
        }
    });

    // Actualizar vista previa con datos de prueba
    $('#updatePreviewBtn').click(function() {
        const content = $('#templateContent').val() || 
                      (selectedTemplate ? getTemplateById(selectedTemplate).content : '');
        renderTemplatePreview(content);
    });

    // Cargar plantilla en mensaje masivo
    $('#loadTemplateBtn').click(function() {
        showTemplateSelector();
    });

    // Guardar mensaje actual como plantilla
    $('#saveAsTemplateBtn').click(function() {
        saveCurrentMessageAsTemplate();
    });

    // Modal de guardar plantilla rápida
    $('#saveQuickTemplateBtn').click(function() {
        const name = $('#quickTemplateName').val().trim();
        const category = $('#quickTemplateCategory').val();
        const isDefault = $('#quickTemplateDefault').is(':checked');
        const content = $('#messageTemplate').val().trim();

        if (!name) {
            Swal.fire({
                icon: 'warning',
                title: 'Nombre Requerido',
                text: 'Por favor ingresa un nombre para la plantilla',
                confirmButtonText: 'Entendido'
            });
            return;
        }

        // Si se marca como por defecto, quitar el flag de otras plantillas
        if (isDefault) {
            savedTemplates.forEach(t => t.isDefault = false);
        }

        const template = {
            id: generateTemplateId(),
            name: name,
            category: category,
            content: content,
            isDefault: isDefault,
            createdAt: new Date().toISOString(),
            usageCount: 0
        };

        savedTemplates.unshift(template);
        saveTemplatesToStorage();
        displayTemplates();

        $('#saveTemplateModal').modal('hide');
        $('#quickTemplateName').val('');
        
        Swal.fire({
            icon: 'success',
            title: '¡Plantilla Guardada!',
            text: `La plantilla "${name}" se guardó correctamente`,
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    });

    // Filtros de categoría
    $('.filter-category').click(function(e) {
        e.preventDefault();
        const category = $(this).data('category');
        displayTemplates(category);
        
        // Actualizar estado visual del filtro
        $('.filter-category').removeClass('active');
        $(this).addClass('active');
    });

    // Variables dinámicas automáticas en el editor
    $('#templateContent').on('input', function() {
        highlightVariables($(this));
    });

    $('#messageTemplate').on('input', function() {
        highlightVariables($(this));
    });
}

// ============================
// MODAL DE SELECCIÓN DE PLANTILLAS
// ============================

function showTemplateSelector() {
    if (savedTemplates.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin Plantillas',
            text: 'No tienes plantillas guardadas. Crea una plantilla primero.',
            confirmButtonText: 'Crear Plantilla',
            showCancelButton: true,
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                $('#templates-tab').click();
            }
        });
        return;
    }

    loadTemplatesInModal();
    $('#templateSelectorModal').modal('show');
}

function loadTemplatesInModal() {
    const container = $('#modalTemplatesList');
    let html = '';

    savedTemplates.forEach(template => {
        const isDefault = template.isDefault ? '★ ' : '';
        html += `
            <div class="modal-template-item" data-id="${template.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <strong>${isDefault}${escapeHtml(template.name)}</strong>
                        <div class="small text-muted">${getCategoryName(template.category)}</div>
                    </div>
                    <span class="badge bg-secondary">${template.content.length}</span>
                </div>
            </div>
        `;
    });

    container.html(html);

    // Event listeners para selección en modal
    $('.modal-template-item').click(function() {
        $('.modal-template-item').removeClass('selected');
        $(this).addClass('selected');
        
        const templateId = $(this).data('id');
        const template = getTemplateById(templateId);
        
        if (template) {
            $('#modalTemplatePreview').html(formatWhatsAppText(template.content));
            $('#modalTemplateCategory').text(getCategoryName(template.category));
            $('#modalTemplateDate').text(formatDate(template.createdAt));
            $('#selectTemplateBtn').prop('disabled', false).data('template-id', templateId);
        }
    });
}

// Event listener para el botón de seleccionar plantilla en modal
$(document).ready(function() {
    $('#selectTemplateBtn').click(function() {
        const templateId = $(this).data('template-id');
        const template = getTemplateById(templateId);
        
        if (template) {
            $('#messageTemplate').val(template.content);
            updateBulkButton();
            
            // Incrementar contador de uso
            template.usageCount = (template.usageCount || 0) + 1;
            saveTemplatesToStorage();
            
            $('#templateSelectorModal').modal('hide');
            
            Swal.fire({
                icon: 'success',
                title: 'Plantilla Aplicada',
                text: `Se aplicó la plantilla "${template.name}"`,
                timer: 2000,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    });
});

// ============================
// FUNCIONES DE UTILIDAD
// ============================

function getTemplateById(id) {
    return savedTemplates.find(t => t.id === id);
}

function getCategoryName(category) {
    const categories = {
        cobranza: 'Cobranza',
        promociones: 'Promociones',
        informativo: 'Informativo',
        soporte: 'Soporte',
        otro: 'Otro'
    };
    return categories[category] || 'Otro';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function highlightVariables(textarea) {
    // Esta función podría implementar resaltado de variables en tiempo real
    // Por simplicidad, solo contaremos caracteres por ahora
    const length = textarea.val().length;
    textarea.siblings('.template-char-count, #templateCharCount').text(`${length} caracteres`);
}

// ============================
// PROCESAMIENTO DE VARIABLES DINÁMICAS
// ============================

function processMessageWithVariables(messageTemplate, contact) {
    if (!messageTemplate || !contact) return messageTemplate;

    // Datos actuales
    const now = new Date();
    const currentData = {
        fecha: now.toLocaleDateString('es-ES'),
        mes: now.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase(),
        año: now.getFullYear(),
        empresa: 'Cable Hogar' // Esto podría venir de configuración
    };

    // Combinar datos del contacto con datos actuales
    const allData = {
        nombre: contact.name || '',
        valor: contact.value || '',
        telefono: contact.phone || '',
        personalizado1: contact.custom1 || '',
        personalizado2: contact.custom2 || '',
        ...currentData
    };

    // Reemplazar todas las variables
    let processedMessage = messageTemplate;
    Object.keys(allData).forEach(key => {
        const regex = new RegExp(`{${key}}`, 'g');
        processedMessage = processedMessage.replace(regex, allData[key]);
    });

    return processedMessage;
}

// ============================
// MODIFICAR FUNCIÓN DE ENVÍO PARA USAR PLANTILLAS
// ============================

// MODIFICAR LA FUNCIÓN sendSingleMessageInternal EXISTENTE para usar variables dinámicas
async function sendSingleMessageInternal(contact, message) {
    try {
        // Procesar mensaje con variables dinámicas
        const processedMessage = processMessageWithVariables(message, contact);
        
        const response = await $.post('/whatsapp/send-single', {
            phone: contact.phone,
            message: processedMessage
        });
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: response.success,
            message: response.success ? 'Enviado correctamente' : response.message,
            attempts: 1,
            processedMessage: processedMessage // Para debugging
        };
        
    } catch (xhr) {
        let errorMessage = 'Error de conexión';
        try {
            const response = JSON.parse(xhr.responseText);
            errorMessage = response.message || errorMessage;
        } catch (e) {
            // Mantener mensaje por defecto
        }
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: false,
            message: errorMessage,
            attempts: 1
        };
    }
}

// ============================
// IMPORTAR/EXPORTAR PLANTILLAS
// ============================

function exportTemplates() {
    const dataStr = JSON.stringify(savedTemplates, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `plantillas_whatsapp_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    Swal.fire({
        icon: 'success',
        title: 'Plantillas Exportadas',
        text: 'Las plantillas se descargaron correctamente',
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

function importTemplates() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedTemplates = JSON.parse(e.target.result);
                
                if (!Array.isArray(importedTemplates)) {
                    throw new Error('Formato de archivo inválido');
                }
                
                // Validar estructura de plantillas
                const validTemplates = importedTemplates.filter(template => 
                    template.name && template.content && template.category
                );
                
                if (validTemplates.length === 0) {
                    throw new Error('No se encontraron plantillas válidas en el archivo');
                }
                
                Swal.fire({
                    icon: 'question',
                    title: 'Importar Plantillas',
                    html: `Se encontraron <strong>${validTemplates.length}</strong> plantillas válidas.<br>¿Cómo quieres importarlas?`,
                    showCancelButton: true,
                    confirmButtonText: 'Reemplazar Todas',
                    cancelButtonText: 'Agregar a Existentes',
                    showDenyButton: true,
                    denyButtonText: 'Cancelar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // Reemplazar todas
                        savedTemplates = validTemplates.map(t => ({
                            ...t,
                            id: generateTemplateId(),
                            createdAt: new Date().toISOString(),
                            usageCount: 0
                        }));
                    } else if (result.dismiss === Swal.DismissReason.cancel) {
                        // Agregar a existentes
                        const newTemplates = validTemplates.map(t => ({
                            ...t,
                            id: generateTemplateId(),
                            createdAt: new Date().toISOString(),
                            usageCount: 0,
                            isDefault: false // No mantener defaults al importar
                        }));
                        savedTemplates = [...newTemplates, ...savedTemplates];
                    } else {
                        return;
                    }
                    
                    saveTemplatesToStorage();
                    displayTemplates();
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Plantillas Importadas',
                        text: `Se importaron ${validTemplates.length} plantillas correctamente`,
                        timer: 3000,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                });
                
            } catch (error) {
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Importación',
                    text: 'El archivo no tiene el formato correcto: ' + error.message,
                    confirmButtonText: 'Entendido'
                });
            }
        };
        
        reader.readAsText(file);
    };
    
    input.click();
}

// ============================
// BÚSQUEDA Y FILTRADO DE PLANTILLAS
// ============================

function initializeTemplateSearch() {
    // Agregar campo de búsqueda si no existe
    if ($('#templateSearch').length === 0) {
        const searchHtml = `
            <div class="template-search mb-3">
                <input type="text" class="form-control" id="templateSearch" 
                       placeholder="Buscar plantillas por nombre o contenido...">
            </div>
        `;
        $('#templatesList').before(searchHtml);
    }
    
    // Event listener para búsqueda en tiempo real
    $('#templateSearch').on('input', function() {
        const searchTerm = $(this).val().toLowerCase().trim();
        searchTemplates(searchTerm);
    });
}

function searchTemplates(searchTerm) {
    if (!searchTerm) {
        displayTemplates();
        return;
    }
    
    const filteredTemplates = savedTemplates.filter(template => 
        template.name.toLowerCase().includes(searchTerm) ||
        template.content.toLowerCase().includes(searchTerm) ||
        getCategoryName(template.category).toLowerCase().includes(searchTerm)
    );
    
    displayFilteredTemplates(filteredTemplates, `Resultados para: "${searchTerm}"`);
}

function displayFilteredTemplates(templates, title) {
    const container = $('#templatesList');
    
    if (templates.length === 0) {
        container.html(`
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <h5>Sin Resultados</h5>
                <p>${title}</p>
                <button class="btn btn-outline-primary" onclick="$('#templateSearch').val('').trigger('input')">
                    <i class="fas fa-times me-2"></i>Limpiar Búsqueda
                </button>
            </div>
        `);
        return;
    }
    
    // Reutilizar la función de display existente con los templates filtrados
    const originalTemplates = savedTemplates;
    savedTemplates = templates;
    displayTemplates();
    savedTemplates = originalTemplates;
}

// ============================
// INICIALIZACIÓN COMPLETA
// ============================

// MODIFICAR LA FUNCIÓN $(document).ready EXISTENTE para incluir las plantillas
$(document).ready(function() {
    // ... código existente ...
    
    // Inicializar sistema de plantillas
    initializeTemplateSystem();
    initializeTemplateSearch();
    
    // Cargar plantilla por defecto si existe
    const defaultTemplate = savedTemplates.find(t => t.isDefault);
    if (defaultTemplate) {
        $('#messageTemplate').val(defaultTemplate.content);
        updateBulkButton();
    }
    
    // Actualizar contador de caracteres para plantillas
    $('#templateContent').on('input', function() {
        const length = $(this).val().length;
        $('#templateCharCount').text(`${length} caracteres`);
    });
});
function initializeSingleMessageTemplates() {
    loadTemplatesInSingleSelector();
    initializeSingleMessageEvents();
    updateSinglePreviewTime();
    setInterval(updateSinglePreviewTime, 60000);
}

function loadTemplatesInSingleSelector() {
    const selector = $('#singleTemplateSelector');
    selector.addClass('loading');
    
    // Limpiar opciones existentes
    selector.empty().append('<option value="">Seleccionar plantilla...</option>');
    
    if (savedTemplates && savedTemplates.length > 0) {
        // Agrupar por categoría
        const templatesByCategory = savedTemplates.reduce((acc, template) => {
            const category = getCategoryName(template.category);
            if (!acc[category]) acc[category] = [];
            acc[category].push(template);
            return acc;
        }, {});
        
        // Agregar templates agrupados
        Object.keys(templatesByCategory).forEach(categoryName => {
            const optgroup = $(`<optgroup label="${categoryName}"></optgroup>`);
            
            templatesByCategory[categoryName].forEach(template => {
                const isDefault = template.isDefault ? ' ⭐' : '';
                const usageCount = template.usageCount ? ` (${template.usageCount} usos)` : '';
                const option = $(`<option value="${template.id}">${template.name}${isDefault}${usageCount}</option>`);
                optgroup.append(option);
            });
            
            selector.append(optgroup);
        });
        
        // Seleccionar plantilla por defecto si existe
        const defaultTemplate = savedTemplates.find(t => t.isDefault);
        if (defaultTemplate) {
            selector.val(defaultTemplate.id);
            $('#applySingleTemplateBtn').prop('disabled', false);
        }
    } else {
        selector.append('<option disabled>No hay plantillas disponibles</option>');
    }
    
    selector.removeClass('loading');
}

function initializeSingleMessageEvents() {
    // Cambio en selector de plantillas
    $('#singleTemplateSelector').change(function() {
        const templateId = $(this).val();
        $('#applySingleTemplateBtn').prop('disabled', !templateId);
        
        if (templateId) {
            const template = getTemplateById(templateId);
            if (template) {
                // Mostrar vista previa de la plantilla seleccionada
                updateSingleMessagePreview(template.content);
            }
        } else {
            updateSingleMessagePreview('');
        }
    });
    
    // Aplicar plantilla seleccionada
    $('#applySingleTemplateBtn').click(function() {
        const templateId = $('#singleTemplateSelector').val();
        if (!templateId) return;
        
        const template = getTemplateById(templateId);
        if (template) {
            $('#message').val(template.content).addClass('template-applied');
            updateCharCount();
            updateSingleMessagePreview();
            
            // Incrementar contador de uso
            template.usageCount = (template.usageCount || 0) + 1;
            saveTemplatesToStorage();
            
            // Animación de confirmación
            setTimeout(() => {
                $('#message').removeClass('template-applied');
            }, 500);
            
            Swal.fire({
                icon: 'success',
                title: 'Plantilla Aplicada',
                text: `Se aplicó la plantilla "${template.name}"`,
                timer: 2000,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    });
    
    // Limpiar mensaje
    $('#clearSingleMessageBtn').click(function() {
        Swal.fire({
            icon: 'question',
            title: '¿Limpiar mensaje?',
            text: '¿Estás seguro de que quieres limpiar el mensaje actual?',
            showCancelButton: true,
            confirmButtonText: 'Sí, limpiar',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                $('#message').val('');
                $('#singleContactName').val('');
                $('#singleContactValue').val('');
                $('#singleTemplateSelector').val('');
                $('#applySingleTemplateBtn').prop('disabled', true);
                updateCharCount();
                updateSingleMessagePreview();
                
                Swal.fire({
                    icon: 'success',
                    title: 'Mensaje Limpiado',
                    timer: 1500,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
            }
        });
    });
    
    // Guardar mensaje actual como plantilla
    $('#saveSingleAsTemplateBtn').click(function() {
        const content = $('#message').val().trim();
        if (!content) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin Contenido',
                text: 'Escribe un mensaje antes de guardarlo como plantilla',
                confirmButtonText: 'Entendido'
            });
            return;
        }
        
        // Pre-llenar modal con datos del formulario
        const contactName = $('#singleContactName').val().trim();
        if (contactName) {
            $('#quickTemplateName').val(`Plantilla para ${contactName}`);
        }
        
        $('#saveTemplateModal').modal('show');
    });
    
    // Actualizar plantillas
    $('#refreshSingleTemplatesBtn').click(function() {
        const btn = $(this);
        const originalHtml = btn.html();
        
        btn.html('<i class="fas fa-spinner fa-spin me-1"></i>Actualizando...')
           .prop('disabled', true);
        
        setTimeout(() => {
            loadTemplatesInSingleSelector();
            btn.html(originalHtml).prop('disabled', false);
            
            Swal.fire({
                icon: 'success',
                title: 'Plantillas Actualizadas',
                timer: 1500,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }, 500);
    });
    
    // Actualizar vista previa en tiempo real
    $('#message, #singleContactName, #singleContactValue').on('input', function() {
        updateSingleMessagePreview();
    });
}

function updateSingleMessagePreview(templateContent = null) {
    const content = templateContent || $('#message').val();
    
    if (!content.trim()) {
        $('#singlePreviewContent').text('Escribe o selecciona una plantilla para ver la vista previa');
        return;
    }
    
    // Datos para reemplazo de variables
    const previewData = {
        nombre: $('#singleContactName').val() || 'Cliente',
        valor: $('#singleContactValue').val() || '$0.00',
        telefono: $('#phone').val() || '593XXXXXXXXX',
        fecha: new Date().toLocaleDateString('es-ES'),
        mes: new Date().toLocaleDateString('es-ES', { month: 'long' }).toUpperCase(),
        año: new Date().getFullYear(),
        empresa: 'Cable Hogar'
    };
    
    // Reemplazar variables
    let processedContent = content;
    Object.keys(previewData).forEach(key => {
        const regex = new RegExp(`{${key}}`, 'g');
        processedContent = processedContent.replace(regex, previewData[key]);
    });
    
    // Formatear para WhatsApp
    processedContent = formatWhatsAppText(processedContent);
    
    // Actualizar vista previa
    $('#singlePreviewContent').html(processedContent).addClass('preview-updated');
    
    setTimeout(() => {
        $('#singlePreviewContent').removeClass('preview-updated');
    }, 300);
}

function updateSinglePreviewTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    $('#singlePreviewTime').text(timeString);
}

// ============================
// FUNCIONES GLOBALES EXPUESTAS
// ============================

// Hacer funciones disponibles globalmente para onclick handlers
window.editTemplate = editTemplate;
window.duplicateTemplate = duplicateTemplate;
window.deleteTemplate = deleteTemplate;
window.setAsDefault = setAsDefault;
window.exportTemplates = exportTemplates;
window.importTemplates = importTemplates;