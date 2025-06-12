<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Response;

class WhatsAppController extends Controller
{
    private $whatsappApiUrl = 'http://localhost:3001';
    
    // Configuración optimizada para envíos masivos
    private $config = [
        'max_contacts_per_file' => 10000,
        'default_timeout' => 15, // segundos
        'max_retries' => 3,
        'cache_ttl' => 3600, // 1 hora
        'rate_limit_delay' => 2, // segundos entre mensajes
        'batch_processing_enabled' => true,
        'max_file_size' => 52428800, // 50MB en bytes
        'allowed_extensions' => ['xlsx', 'xls'],
        'temp_folder' => 'temp_excel'
    ];

    /**
     * Mostrar página principal del sistema
     */
    public function index()
    {
        return view('welcome');
    }

    /**
     * Verificar estado de conexión con WhatsApp API
     * Implementa cache para reducir carga en la API
     */
    public function checkStatus()
    {
        $cacheKey = 'whatsapp_connection_status';
        
        try {
            return Cache::remember($cacheKey, 30, function () {
                $response = Http::timeout(5)->get($this->whatsappApiUrl . '/estado');
                
                if ($response->successful()) {
                    $data = $response->json();
                    Log::info('WhatsApp status check successful', $data);
                    return response()->json($data);
                }
                
                Log::warning('WhatsApp API returned unsuccessful response', [
                    'status' => $response->status(),
                    'body' => $response->body()
                ]);
                
                return response()->json([
                    'ready' => false,
                    'error' => 'Respuesta inválida del servidor WhatsApp',
                    'status_code' => $response->status()
                ], 500);
            });
            
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            Log::error('WhatsApp connection failed: ' . $e->getMessage());
            
            return response()->json([
                'ready' => false,
                'error' => 'No se puede conectar con el servidor de WhatsApp. Verifica que esté ejecutándose en ' . $this->whatsappApiUrl
            ], 500);
            
        } catch (\Exception $e) {
            Log::error('WhatsApp status check error: ' . $e->getMessage());
            
            return response()->json([
                'ready' => false,
                'error' => 'Error interno verificando estado de WhatsApp'
            ], 500);
        }
    }

    /**
     * Enviar mensaje individual con validación robusta
     */
    public function sendSingleMessage(Request $request)
    {
        try {
            // Validación de entrada
            $validated = $request->validate([
                'phone' => [
                    'required',
                    'string',
                    'regex:/^[0-9]{10,15}$/'
                ],
                'message' => [
                    'required',
                    'string',
                    'max:4000',
                    'min:1'
                ]
            ], [
                'phone.required' => 'El número de teléfono es obligatorio',
                'phone.regex' => 'El número debe tener entre 10 y 15 dígitos sin espacios ni caracteres especiales',
                'message.required' => 'El mensaje es obligatorio',
                'message.max' => 'El mensaje no puede exceder 4000 caracteres',
                'message.min' => 'El mensaje no puede estar vacío'
            ]);

            // Limpiar número de teléfono
            $cleanPhone = preg_replace('/[^0-9]/', '', $validated['phone']);
            
            Log::info("Intentando enviar mensaje individual a: {$cleanPhone}");

            // Enviar mensaje a la API de WhatsApp
            $response = Http::timeout($this->config['default_timeout'])
                ->retry(2, 100) // 2 reintentos con 100ms de delay
                ->post($this->whatsappApiUrl . '/enviarMensaje', [
                    'phone' => $cleanPhone,
                    'message' => $validated['message']
                ]);

            if ($response->successful()) {
                $responseData = $response->json();
                
                if (isset($responseData['success']) && $responseData['success']) {
                    Log::info("Mensaje enviado exitosamente a: {$cleanPhone}");
                    
                    return response()->json([
                        'success' => true,
                        'message' => 'Mensaje enviado correctamente',
                        'phone' => $cleanPhone
                    ]);
                } else {
                    Log::warning("API respondió sin éxito para {$cleanPhone}", $responseData);
                    
                    return response()->json([
                        'success' => false,
                        'message' => $responseData['message'] ?? 'Error desconocido de la API'
                    ], 400);
                }
            }

            // Manejar respuestas HTTP no exitosas
            $errorData = $response->json();
            Log::error("Error HTTP enviando mensaje a {$cleanPhone}", [
                'status' => $response->status(),
                'response' => $errorData
            ]);

            return response()->json([
                'success' => false,
                'message' => $errorData['message'] ?? 'Error del servidor WhatsApp'
            ], 400);

        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Datos inválidos: ' . implode(', ', $e->validator->errors()->all())
            ], 422);
            
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            Log::error('Error de conexión WhatsApp API: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'No se puede conectar con el servidor de WhatsApp. Verifica que esté funcionando.'
            ], 503);
            
        } catch (\Exception $e) {
            Log::error('Error enviando mensaje individual: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error interno del servidor'
            ], 500);
        }
    }

    /**
     * Subir y procesar archivo Excel optimizado para grandes volúmenes
     */
    public function uploadExcel(Request $request)
    {
        try {
            // Validación inicial del archivo
            $validated = $request->validate([
                'excel_file' => [
                    'required',
                    'file',
                    'mimes:xlsx,xls',
                    'max:51200' // 50MB
                ]
            ], [
                'excel_file.required' => 'Debe seleccionar un archivo Excel',
                'excel_file.mimes' => 'El archivo debe ser de tipo Excel (.xlsx o .xls)',
                'excel_file.max' => 'El archivo no puede exceder 50MB'
            ]);

            $file = $request->file('excel_file');
            
            if (!$file->isValid()) {
                return response()->json([
                    'success' => false,
                    'message' => 'El archivo subido no es válido'
                ], 400);
            }

            // Configurar límites para archivos grandes
            ini_set('memory_limit', '1024M'); // 1GB
            set_time_limit(300); // 5 minutos

            Log::info('Iniciando procesamiento de Excel', [
                'filename' => $file->getClientOriginalName(),
                'size' => $file->getSize(),
                'mime' => $file->getMimeType()
            ]);

            // Crear directorio temporal
            $tempPath = storage_path('app/' . $this->config['temp_folder']);
            if (!file_exists($tempPath)) {
                mkdir($tempPath, 0755, true);
            }

            // Generar nombre único para el archivo
            $fileName = uniqid('excel_') . '_' . time() . '.' . $file->getClientOriginalExtension();
            $filePath = $tempPath . '/' . $fileName;
            
            // Mover archivo al directorio temporal
            if (!$file->move($tempPath, $fileName)) {
                return response()->json([
                    'success' => false,
                    'message' => 'No se pudo guardar el archivo temporalmente'
                ], 500);
            }

            // Verificar que PhpSpreadsheet esté disponible
            if (!class_exists('\PhpOffice\PhpSpreadsheet\IOFactory')) {
                $this->cleanupFile($filePath);
                return response()->json([
                    'success' => false,
                    'message' => 'PhpSpreadsheet no está instalado. Ejecuta: composer require phpoffice/phpspreadsheet'
                ], 500);
            }

            // Procesar archivo Excel
            $processedData = $this->processExcelFile($filePath);
            
            // Limpiar archivo temporal inmediatamente
            $this->cleanupFile($filePath);

            if (!$processedData['success']) {
                return response()->json($processedData, 400);
            }

            $contacts = $processedData['contacts'];
            
            // Verificar límite de contactos
            if (count($contacts) > $this->config['max_contacts_per_file']) {
                Log::warning("Archivo excede límite de contactos", [
                    'found' => count($contacts),
                    'limit' => $this->config['max_contacts_per_file']
                ]);
                
                $contacts = array_slice($contacts, 0, $this->config['max_contacts_per_file']);
            }

            // Guardar contactos en cache para uso posterior
            $cacheKey = 'contacts_' . uniqid() . '_' . time();
            Cache::put($cacheKey, $contacts, $this->config['cache_ttl']);

            Log::info('Excel procesado exitosamente', [
                'total_contacts' => count($contacts),
                'skipped_rows' => $processedData['skipped'],
                'cache_key' => $cacheKey
            ]);

            return response()->json([
                'success' => true,
                'contacts' => $contacts,
                'total' => count($contacts),
                'skipped' => $processedData['skipped'],
                'cache_key' => $cacheKey,
                'message' => "Se cargaron " . count($contacts) . " contactos correctamente"
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error de validación: ' . implode(', ', $e->validator->errors()->all())
            ], 422);
            
        } catch (\Exception $e) {
            Log::error('Error procesando archivo Excel: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            
            // Limpiar archivo si existe
            if (isset($filePath)) {
                $this->cleanupFile($filePath);
            }
            
            return response()->json([
                'success' => false,
                'message' => 'Error procesando el archivo: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Envío masivo optimizado con procesamiento por lotes
     */
    public function sendBulkMessages(Request $request)
    {
        try {
            // Configurar para procesamiento de larga duración
            set_time_limit(0); // Sin límite de tiempo
            ini_set('max_execution_time', 0);
            ignore_user_abort(true); // Continuar aunque el usuario cierre el navegador
            
            // Validación de entrada
            $validated = $request->validate([
                'contacts' => 'required|array|max:10000',
                'contacts.*.name' => 'required|string|max:255',
                'contacts.*.phone' => 'required|string|regex:/^[0-9]{10,15}$/',
                'contacts.*.value' => 'sometimes|string|max:100',
                'message_template' => 'required|string|max:4000|min:1',
                'batch_size' => 'sometimes|integer|min:10|max:500',
                'delay_between_messages' => 'sometimes|integer|min:1|max:10',
                'delay_between_batches' => 'sometimes|integer|min:5|max:120'
            ], [
                'contacts.required' => 'La lista de contactos es obligatoria',
                'contacts.max' => 'Máximo 10,000 contactos por envío',
                'message_template.required' => 'La plantilla de mensaje es obligatoria',
                'message_template.max' => 'El mensaje no puede exceder 4000 caracteres'
            ]);

            $contacts = $validated['contacts'];
            $messageTemplate = $validated['message_template'];
            $batchSize = $validated['batch_size'] ?? 100;
            $delayBetweenMessages = $validated['delay_between_messages'] ?? 2;
            $delayBetweenBatches = $validated['delay_between_batches'] ?? 10;
            
            $totalContacts = count($contacts);
            $startTime = microtime(true);
            
            Log::info("=== INICIANDO ENVÍO MASIVO ===", [
                'total_contacts' => $totalContacts,
                'batch_size' => $batchSize,
                'delay_between_messages' => $delayBetweenMessages,
                'delay_between_batches' => $delayBetweenBatches,
                'estimated_duration_minutes' => round(($totalContacts * $delayBetweenMessages + ceil($totalContacts / $batchSize) * $delayBetweenBatches) / 60, 2)
            ]);

            // Variables de seguimiento
            $processedCount = 0;
            $successCount = 0;
            $failedCount = 0;
            $results = [];
            
            // Dividir contactos en lotes
            $batches = array_chunk($contacts, $batchSize);
            $totalBatches = count($batches);
            
            Log::info("Contactos divididos en {$totalBatches} lotes de máximo {$batchSize} contactos");

            // Procesar cada lote
            foreach ($batches as $batchIndex => $batch) {
                $currentBatch = $batchIndex + 1;
                $batchStartTime = microtime(true);
                
                Log::info("=== PROCESANDO LOTE {$currentBatch}/{$totalBatches} ===", [
                    'contacts_in_batch' => count($batch),
                    'processed_so_far' => $processedCount
                ]);
                
                // Procesar cada contacto en el lote
                foreach ($batch as $contactIndex => $contact) {
                    try {
                        $result = $this->sendSingleMessageInternal($contact, $messageTemplate);
                        
                        $results[] = $result;
                        
                        if ($result['success']) {
                            $successCount++;
                        } else {
                            $failedCount++;
                        }
                        
                        $processedCount++;
                        
                        // Log cada 50 mensajes procesados
                        if ($processedCount % 50 === 0) {
                            $elapsedTime = microtime(true) - $startTime;
                            $averageTimePerMessage = $elapsedTime / $processedCount;
                            $estimatedTotalTime = $averageTimePerMessage * $totalContacts;
                            $estimatedRemainingTime = $estimatedTotalTime - $elapsedTime;
                            
                            Log::info("PROGRESO: {$processedCount}/{$totalContacts}", [
                                'success_rate' => round(($successCount / $processedCount) * 100, 2) . '%',
                                'avg_time_per_message' => round($averageTimePerMessage, 2) . 's',
                                'estimated_remaining_minutes' => round($estimatedRemainingTime / 60, 2)
                            ]);
                        }

                        // Delay entre mensajes (excepto el último del lote)
                        if ($contactIndex < count($batch) - 1) {
                            sleep($delayBetweenMessages);
                        }

                    } catch (\Exception $e) {
                        Log::error("Error procesando contacto en lote {$currentBatch}", [
                            'contact' => $contact,
                            'error' => $e->getMessage()
                        ]);
                        
                        $results[] = [
                            'name' => $contact['name'] ?? 'Error',
                            'phone' => $contact['phone'] ?? 'Error',
                            'success' => false,
                            'message' => 'Error interno: ' . $e->getMessage(),
                            'attempts' => 1
                        ];
                        
                        $failedCount++;
                        $processedCount++;
                    }
                }

                $batchTime = microtime(true) - $batchStartTime;
                Log::info("LOTE {$currentBatch} COMPLETADO", [
                    'batch_duration_seconds' => round($batchTime, 2),
                    'messages_per_second' => round(count($batch) / $batchTime, 2)
                ]);

                // Delay entre lotes (excepto el último)
                if ($currentBatch < $totalBatches) {
                    Log::info("Esperando {$delayBetweenBatches} segundos antes del siguiente lote...");
                    sleep($delayBetweenBatches);
                }
            }

            // Estadísticas finales
            $totalTime = microtime(true) - $startTime;
            $successRate = $totalContacts > 0 ? round(($successCount / $totalContacts) * 100, 2) : 0;
            
            Log::info("=== ENVÍO MASIVO COMPLETADO ===", [
                'total_processed' => $processedCount,
                'successful' => $successCount,
                'failed' => $failedCount,
                'success_rate' => $successRate . '%',
                'total_duration_minutes' => round($totalTime / 60, 2),
                'average_time_per_message' => round($totalTime / $totalContacts, 2) . 's',
                'messages_per_minute' => round(($totalContacts / $totalTime) * 60, 2)
            ]);

            return response()->json([
                'success' => true,
                'results' => $results,
                'statistics' => [
                    'total_contacts' => $totalContacts,
                    'total_sent' => $successCount,
                    'total_failed' => $failedCount,
                    'total_processed' => $processedCount,
                    'success_rate' => $successRate,
                    'batches_processed' => $totalBatches,
                    'duration_seconds' => round($totalTime, 2),
                    'duration_formatted' => $this->formatDuration($totalTime),
                    'average_time_per_message' => round($totalTime / $totalContacts, 2),
                    'messages_per_minute' => round(($totalContacts / $totalTime) * 60, 2)
                ],
                'message' => "Envío completado: {$successCount} exitosos, {$failedCount} fallidos de {$totalContacts} total"
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('Error de validación en envío masivo', [
                'errors' => $e->validator->errors()->all()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error de validación: ' . implode(', ', $e->validator->errors()->all())
            ], 422);
            
        } catch (\Exception $e) {
            Log::error('Error crítico en envío masivo', [
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error crítico durante el envío: ' . $e->getMessage(),
                'partial_results' => $results ?? [],
                'processed_count' => $processedCount ?? 0,
                'success_count' => $successCount ?? 0,
                'failed_count' => $failedCount ?? 0
            ], 500);
        }
    }

    /**
     * MÉTODOS PRIVADOS DE UTILIDAD
     */

    /**
     * Procesar archivo Excel y extraer contactos
     */
    private function processExcelFile($filePath)
    {
        try {
            $spreadsheet = IOFactory::load($filePath);
            $worksheet = $spreadsheet->getActiveSheet();
            $highestRow = $worksheet->getHighestRow();
            $highestColumn = $worksheet->getHighestColumn();

            Log::info("Leyendo Excel", [
                'rows' => $highestRow,
                'columns' => $highestColumn
            ]);

            // Verificar límite de filas
            if ($highestRow > $this->config['max_contacts_per_file'] + 1) {
                return [
                    'success' => false,
                    'message' => "El archivo tiene {$highestRow} filas. Máximo permitido: {$this->config['max_contacts_per_file']} contactos."
                ];
            }

            // Leer datos eficientemente
            $data = [];
            for ($row = 1; $row <= $highestRow; $row++) {
                $rowData = [];
                for ($col = 'A'; $col <= $highestColumn; $col++) {
                    $cellValue = $worksheet->getCell($col . $row)->getCalculatedValue();
                    $rowData[] = $this->cleanCellValue($cellValue);
                }
                $data[] = $rowData;
            }

            // Procesar headers
            if (empty($data) || count($data) < 2) {
                return [
                    'success' => false,
                    'message' => 'El archivo debe tener al menos una fila de headers y una fila de datos'
                ];
            }

            $headers = $this->processHeaders($data[0]);
            $columnMapping = $this->findRequiredColumns($headers);

            if (!$columnMapping) {
                return [
                    'success' => false,
                    'message' => 'No se encontraron las columnas requeridas. Headers encontrados: [' . implode(', ', $headers) . ']. Se necesitan: nombres/nombre y numero/telefono'
                ];
            }

            // Procesar contactos
            $processedContacts = $this->processContactsOptimized($data, $columnMapping);

            return [
                'success' => true,
                'contacts' => $processedContacts['valid'],
                'skipped' => $processedContacts['skipped']
            ];

        } catch (\Exception $e) {
            Log::error('Error procesando Excel: ' . $e->getMessage());
            
            return [
                'success' => false,
                'message' => 'Error leyendo archivo Excel: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Enviar mensaje individual interno (para uso en envío masivo)
     */
    private function sendSingleMessageInternal($contact, $messageTemplate)
    {
        $maxRetries = $this->config['max_retries'];
        $attempt = 0;
        $lastError = '';

        // Validar datos del contacto
        if (empty($contact['name']) || empty($contact['phone'])) {
            return [
                'name' => $contact['name'] ?? 'Sin nombre',
                'phone' => $contact['phone'] ?? 'Sin teléfono',
                'success' => false,
                'message' => 'Datos de contacto incompletos',
                'attempts' => 1
            ];
        }

        // Limpiar y validar número
        $cleanPhone = preg_replace('/[^0-9]/', '', $contact['phone']);
        
        if (strlen($cleanPhone) < 10 || strlen($cleanPhone) > 15) {
            return [
                'name' => $contact['name'],
                'phone' => $contact['phone'],
                'success' => false,
                'message' => 'Número de teléfono inválido (debe tener 10-15 dígitos)',
                'attempts' => 1
            ];
        }

        // Personalizar mensaje
        $personalizedMessage = str_replace(
            ['{nombre}', '{valor}'],
            [$contact['name'], $contact['value'] ?? ''],
            $messageTemplate
        );

        // Intentos de envío
        while ($attempt < $maxRetries) {
            $attempt++;
            
            try {
                $response = Http::timeout($this->config['default_timeout'])
                    ->post($this->whatsappApiUrl . '/enviarMensaje', [
                        'phone' => $cleanPhone,
                        'message' => $personalizedMessage
                    ]);

                if ($response->successful()) {
                    $responseData = $response->json();
                    
                    if (isset($responseData['success']) && $responseData['success']) {
                        return [
                            'name' => $contact['name'],
                            'phone' => $cleanPhone,
                            'success' => true,
                            'message' => 'Enviado correctamente',
                            'attempts' => $attempt
                        ];
                    } else {
                        $lastError = $responseData['message'] ?? 'Respuesta API sin éxito';
                    }
                } else {
                    $errorData = $response->json();
                    $lastError = $errorData['message'] ?? "Error HTTP {$response->status()}";
                }
                
            } catch (\Illuminate\Http\Client\ConnectionException $e) {
                $lastError = 'Error de conexión: ' . $e->getMessage();
                
            } catch (\Exception $e) {
                $lastError = 'Error interno: ' . $e->getMessage();
            }

            // Esperar antes del siguiente intento (excepto en el último)
            if ($attempt < $maxRetries) {
                sleep(2);
            }
        }

        return [
            'name' => $contact['name'],
            'phone' => $cleanPhone,
            'success' => false,
            'message' => $lastError,
            'attempts' => $attempt
        ];
    }

    /**
     * Limpiar valor de celda Excel
     */
    private function cleanCellValue($value)
    {
        if (is_null($value)) return '';
        if (is_bool($value)) return $value ? '1' : '0';
        if (is_numeric($value)) return (string)$value;
        if (is_object($value)) {
            try {
                return (string)$value;
            } catch (\Exception $e) {
                return '';
            }
        }
        return trim((string)$value);
    }

    /**
     * Procesar headers del Excel
     */
    private function processHeaders($headerRow)
    {
        $headers = [];
        foreach ($headerRow as $header) {
            $cleanHeader = strtolower(trim($this->cleanCellValue($header)));
            $headers[] = $cleanHeader;
        }
        return $headers;
    }

    /**
     * Encontrar columnas requeridas en el Excel
     */
    private function findRequiredColumns($headers)
    {
        $nameIndex = false;
        $phoneIndex = false;
        $valueIndex = false;
        
        foreach ($headers as $index => $header) {
            // Buscar columna de nombres
            if (in_array($header, ['nombres', 'nombre', 'name', 'cliente', 'nom'])) {
                $nameIndex = $index;
            }
            // Buscar columna de teléfonos
            if (in_array($header, ['numero', 'telefono', 'phone', 'celular', 'movil', 'tel'])) {
                $phoneIndex = $index;
            }
            // Buscar columna de valores (opcional)
            if (in_array($header, ['valor', 'monto', 'amount', 'precio', 'value', 'deuda', 'saldo'])) {
                $valueIndex = $index;
            }
        }

        // Verificar que se encontraron las columnas obligatorias
        if ($nameIndex === false || $phoneIndex === false) {
            return false;
        }

        return [
            'name' => $nameIndex,
            'phone' => $phoneIndex,
            'value' => $valueIndex
        ];
    }

    /**
     * Procesar contactos del Excel de manera optimizada
     */
    private function processContactsOptimized($data, $columnMapping)
    {
        $validContacts = [];
        $skippedRows = 0;
        
        // Procesar desde la fila 2 (omitir headers)
        for ($i = 1; $i < count($data); $i++) {
            $row = $data[$i];
            
            if (!is_array($row)) {
                $skippedRows++;
                continue;
            }
            
            // Verificar si la fila tiene datos
            $hasData = false;
            foreach ($row as $cell) {
                if (!empty($this->cleanCellValue($cell))) {
                    $hasData = true;
                    break;
                }
            }
            
            if (!$hasData) {
                $skippedRows++;
                continue;
            }
            
            // Extraer datos según el mapeo de columnas
            $name = isset($row[$columnMapping['name']]) ? $this->cleanCellValue($row[$columnMapping['name']]) : '';
            $phone = isset($row[$columnMapping['phone']]) ? $this->cleanCellValue($row[$columnMapping['phone']]) : '';
            $value = '';
            
            if ($columnMapping['value'] !== false && isset($row[$columnMapping['value']])) {
                $value = $this->cleanCellValue($row[$columnMapping['value']]);
            }
            
            // Validaciones de datos
            if (empty($name) || empty($phone)) {
                $skippedRows++;
                continue;
            }

            // Validar que el nombre no sea solo números
            if (is_numeric($name) || strlen($name) < 2) {
                $skippedRows++;
                continue;
            }

            // Limpiar y validar número de teléfono
            $cleanPhone = preg_replace('/[^0-9]/', '', $phone);
            
            // Validar longitud del número
            if (strlen($cleanPhone) < 10 || strlen($cleanPhone) > 15) {
                $skippedRows++;
                continue;
            }

            // Validar que no sea un número repetitivo (como 1111111111)
            if (preg_match('/^(\d)\1{9,}$/', $cleanPhone)) {
                $skippedRows++;
                continue;
            }

            // Agregar contacto válido
            $validContacts[] = [
                'name' => $name,
                'phone' => $cleanPhone,
                'value' => $value
            ];
        }

        return [
            'valid' => $validContacts,
            'skipped' => $skippedRows
        ];
    }

    /**
     * Limpiar archivo temporal
     */
    private function cleanupFile($filePath)
    {
        try {
            if (file_exists($filePath)) {
                unlink($filePath);
                Log::info("Archivo temporal eliminado: {$filePath}");
            }
        } catch (\Exception $e) {
            Log::warning("No se pudo eliminar archivo temporal: {$filePath}", [
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * Formatear duración en formato legible
     */
    private function formatDuration($seconds)
    {
        $hours = floor($seconds / 3600);
        $minutes = floor(($seconds % 3600) / 60);
        $secs = floor($seconds % 60);

        if ($hours > 0) {
            return sprintf('%02d:%02d:%02d', $hours, $minutes, $secs);
        } else {
            return sprintf('%02d:%02d', $minutes, $secs);
        }
    }

    /**
     * MÉTODOS ADICIONALES OPCIONALES
     */

    /**
     * Descargar plantilla de Excel de ejemplo
     */
    public function downloadTemplate()
    {
        try {
            // Crear una hoja de cálculo simple con PhpSpreadsheet
            $spreadsheet = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
            $sheet = $spreadsheet->getActiveSheet();

            // Headers
            $sheet->setCellValue('A1', 'nombres');
            $sheet->setCellValue('B1', 'numero');
            $sheet->setCellValue('C1', 'valor');

            // Datos de ejemplo
            $sheet->setCellValue('A2', 'Juan Pérez');
            $sheet->setCellValue('B2', '593987654321');
            $sheet->setCellValue('C2', '$25.00');

            $sheet->setCellValue('A3', 'María García');
            $sheet->setCellValue('B3', '593987654322');
            $sheet->setCellValue('C3', '$30.00');

            $sheet->setCellValue('A4', 'Carlos López');
            $sheet->setCellValue('B4', '593987654323');
            $sheet->setCellValue('C4', '$15.50');

            // Estilo para headers
            $sheet->getStyle('A1:C1')->getFont()->setBold(true);
            $sheet->getStyle('A1:C1')->getFill()
                ->setFillType(\PhpOffice\PhpSpreadsheet\Style\Fill::FILL_SOLID)
                ->getStartColor()->setARGB('FFCCCCCC');

            // Autoajustar columnas
            foreach (range('A', 'C') as $col) {
                $sheet->getColumnDimension($col)->setAutoSize(true);
            }

            // Configurar writer
            $writer = \PhpOffice\PhpSpreadsheet\IOFactory::createWriter($spreadsheet, 'Xlsx');
            
            // Configurar headers de respuesta
            $fileName = 'plantilla_whatsapp_' . date('Y-m-d') . '.xlsx';
            
            return Response::streamDownload(function() use ($writer) {
                $writer->save('php://output');
            }, $fileName, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ]);

        } catch (\Exception $e) {
            Log::error('Error generando plantilla: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error generando la plantilla: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Obtener estadísticas de envíos
     */
    public function getStatistics()
    {
        try {
            // Aquí podrías implementar un sistema de almacenamiento de estadísticas
            // Por ejemplo, usando una base de datos para guardar históricos de envíos
            
            $stats = [
                'total_messages_sent_today' => 0,
                'total_messages_sent_this_week' => 0,
                'total_messages_sent_this_month' => 0,
                'average_success_rate' => 0,
                'most_common_error' => 'N/A',
                'peak_sending_hour' => 'N/A'
            ];

            return response()->json([
                'success' => true,
                'statistics' => $stats
            ]);

        } catch (\Exception $e) {
            Log::error('Error obteniendo estadísticas: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error obteniendo estadísticas'
            ], 500);
        }
    }

    /**
     * Limpiar archivos temporales antiguos
     */
    public function cleanup()
    {
        try {
            $tempPath = storage_path('app/' . $this->config['temp_folder']);
            
            if (!file_exists($tempPath)) {
                return response()->json([
                    'success' => true,
                    'message' => 'No hay archivos temporales para limpiar'
                ]);
            }

            $files = glob($tempPath . '/*');
            $deletedCount = 0;
            $cutoffTime = time() - 3600; // Archivos más antiguos de 1 hora

            foreach ($files as $file) {
                if (is_file($file) && filemtime($file) < $cutoffTime) {
                    if (unlink($file)) {
                        $deletedCount++;
                    }
                }
            }

            Log::info("Limpieza de archivos temporales completada", [
                'deleted_files' => $deletedCount
            ]);

            return response()->json([
                'success' => true,
                'message' => "Se eliminaron {$deletedCount} archivos temporales",
                'deleted_count' => $deletedCount
            ]);

        } catch (\Exception $e) {
            Log::error('Error en limpieza de archivos: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error durante la limpieza: ' . $e->getMessage()
            ], 500);
        }
    }
}