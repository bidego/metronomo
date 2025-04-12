import tkinter as tk
from tkinter import ttk
import numpy as np
import simpleaudio as sa
import time
import threading

class Metronome:
    def __init__(self, root):
        self.root = root
        self.root.title("Metrónomo")
        
        # Variables
        self.is_playing = False
        self.current_tempo = tk.StringVar(value="120")
        self.tempo = 120
        
        # Crear sonido del metrónomo
        sample_rate = 44100
        duration = 0.1
        t = np.linspace(0, duration, int(sample_rate * duration))
        audio = np.sin(2 * np.pi * 440 * t) * 0.3
        self.click_sound = sa.WaveObject(
            (audio * 32767).astype(np.int16),
            1,
            2,
            sample_rate
        )
        
        # Crear interfaz
        self.create_widgets()
        
    def create_widgets(self):
        # Frame principal
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Etiqueta de tempo
        ttk.Label(main_frame, text="Tempo (BPM):").grid(row=0, column=0, pady=5)
        
        # Entry para el tempo
        tempo_entry = ttk.Entry(main_frame, textvariable=self.current_tempo, width=5)
        tempo_entry.grid(row=0, column=1, pady=5)
        tempo_entry.bind('<Return>', self.update_tempo)
        
        # Slider para el tempo
        self.tempo_slider = ttk.Scale(
            main_frame,
            from_=40,
            to=208,
            orient=tk.HORIZONTAL,
            length=200,
            value=120,
            command=self.slider_changed
        )
        self.tempo_slider.grid(row=1, column=0, columnspan=2, pady=5)
        
        # Botón de inicio/parada
        self.play_button = ttk.Button(
            main_frame,
            text="Iniciar",
            command=self.toggle_play
        )
        self.play_button.grid(row=2, column=0, columnspan=2, pady=10)
        
    def slider_changed(self, value):
        self.tempo = int(float(value))
        self.current_tempo.set(str(self.tempo))
        
    def update_tempo(self, event=None):
        try:
            new_tempo = int(self.current_tempo.get())
            if 40 <= new_tempo <= 208:
                self.tempo = new_tempo
                self.tempo_slider.set(new_tempo)
            else:
                self.current_tempo.set(str(self.tempo))
        except ValueError:
            self.current_tempo.set(str(self.tempo))
            
    def toggle_play(self):
        if self.is_playing:
            self.is_playing = False
            self.play_button.configure(text="Iniciar")
        else:
            self.is_playing = True
            self.play_button.configure(text="Detener")
            threading.Thread(target=self.play_metronome, daemon=True).start()
            
    def play_metronome(self):
        while self.is_playing:
            self.click_sound.play()
            time.sleep(60 / self.tempo)

if __name__ == "__main__":
    root = tk.Tk()
    app = Metronome(root)
    root.mainloop()