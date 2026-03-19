#!/usr/bin/env python3
"""
Script para subir ANA.exe a S3 después del build
Requiere: pip install boto3 python-dotenv
"""

import json
import os
import sys
from pathlib import Path
import threading

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    print("❌ Error: boto3 no está instalado")
    print("Instálalo con: pip install -r requirements.txt")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("❌ Error: python-dotenv no está instalado")
    print("Instálalo con: pip install -r requirements.txt")
    sys.exit(1)

# Cargar variables de entorno desde .env
load_dotenv()

# Configuración
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "ana-backend-storage-prod")
REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

class ProgressPercentage:
    """Callback para mostrar progreso de subida"""
    def __init__(self, filename):
        self._filename = filename
        self._size = float(os.path.getsize(filename))
        self._seen_so_far = 0
        self._lock = threading.Lock()

    def __call__(self, bytes_amount):
        with self._lock:
            self._seen_so_far += bytes_amount
            percentage = (self._seen_so_far / self._size) * 100
            sys.stdout.write(
                f"\r  Progreso: {self._seen_so_far / (1024*1024):.1f}MB / {self._size / (1024*1024):.1f}MB ({percentage:.1f}%)"
            )
            sys.stdout.flush()

def read_version():
    """Lee la versión desde package.json"""
    package_json_path = Path("package.json")
    if not package_json_path.exists():
        raise FileNotFoundError("No se encontró package.json")
    
    # Usar utf-8-sig para manejar BOM (Byte Order Mark) si existe
    with open(package_json_path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
        return data.get('version')

def upload_file_to_s3(s3_client, local_path, s3_key, content_type=None):
    """Sube un archivo a S3 con barra de progreso"""
    extra_args = {}
    if content_type:
        extra_args['ContentType'] = content_type
    
    try:
        progress = ProgressPercentage(str(local_path))
        if extra_args:
            s3_client.upload_file(
                str(local_path),
                BUCKET_NAME,
                s3_key,
                ExtraArgs=extra_args,
                Callback=progress
            )
        else:
            s3_client.upload_file(
                str(local_path),
                BUCKET_NAME,
                s3_key,
                Callback=progress
            )
        print()  # Nueva línea después del progreso
        return True
    except ClientError as e:
        print(f"\n❌ Error al subir {s3_key}: {e}")
        return False

def copy_s3_object(s3_client, source_key, dest_key):
    """Copia un objeto dentro de S3"""
    try:
        s3_client.copy_object(
            Bucket=BUCKET_NAME,
            CopySource={'Bucket': BUCKET_NAME, 'Key': source_key},
            Key=dest_key
        )
        return True
    except ClientError as e:
        print(f"❌ Error al copiar {source_key} a {dest_key}: {e}")
        return False

def main():
    print("== Subiendo ANA a S3 ==\n")
    
    # Leer versión
    try:
        version = read_version()
        print(f"Versión detectada: {version}")
    except Exception as e:
        print(f"❌ Error al leer versión: {e}")
        sys.exit(1)
    
    # Verificar que los archivos existen
    # Buscar el instalador en dist-portable con el nombre versionado
    exe_path = Path(f"dist-portable/ANA-{version}.exe")
    
    # Si no existe con versión, buscar el genérico
    if not exe_path.exists():
        exe_path = Path("dist-portable/ANA-Setup-Portable.exe")
    
    if not exe_path.exists():
        print(f"❌ No se encontró el instalador en dist-portable/")
        print("Ejecuta el build completo primero: .\\build-completo.ps1")
        sys.exit(1)
    
    # Crear latest.json si no existe
    latest_json_path = Path("dist-portable/latest.json")
    if not latest_json_path.exists():
        print(f"[INFO] Creando latest.json...")
        latest_data = {
            "version": version,
            "url": f"https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-{version}.exe"
        }
        with open(latest_json_path, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, indent=2)
        print(f"[OK] latest.json creado")
    
    # Crear cliente S3
    try:
        s3_client = boto3.client('s3', region_name=REGION)
        # Verificar credenciales
        s3_client.list_buckets()
    except NoCredentialsError:
        print("❌ No se encontraron credenciales de AWS")
        print("Configúralas con 'aws configure' o variables de entorno:")
        print("  AWS_ACCESS_KEY_ID")
        print("  AWS_SECRET_ACCESS_KEY")
        sys.exit(1)
    except ClientError as e:
        print(f"❌ Error al conectar con AWS: {e}")
        sys.exit(1)
    
    # Subir archivos
    print(f"\n[1/3] Subiendo ANA-{version}.exe a S3...")
    s3_exe_key = f"versions/ANA-{version}.exe"
    if not upload_file_to_s3(s3_client, exe_path, s3_exe_key):
        sys.exit(1)
    print(f"✅ Subido: {s3_exe_key}")
    
    print(f"\n[2/3] Subiendo latest.json a S3...")
    s3_json_key = "versions/latest.json"
    if not upload_file_to_s3(s3_client, latest_json_path, s3_json_key, content_type='application/json'):
        sys.exit(1)
    print(f"✅ Subido: {s3_json_key}")
    
    print(f"\n[3/3] Creando copia con nombre genérico (ANA-latest.exe)...")
    s3_latest_key = "versions/ANA-latest.exe"
    if not copy_s3_object(s3_client, s3_exe_key, s3_latest_key):
        sys.exit(1)
    print(f"✅ Copiado: {s3_latest_key}")
    
    # Mostrar URLs
    print("\n✅ Subida completada exitosamente!\n")
    print("URLs públicas:")
    print(f"  Versión específica: https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com/versions/ANA-{version}.exe")
    print(f"  Última versión:     https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com/versions/ANA-latest.exe")
    print(f"  Metadata:           https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com/versions/latest.json")
    print()

if __name__ == "__main__":
    main()
