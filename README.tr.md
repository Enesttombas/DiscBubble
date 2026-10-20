<p align="center"><img src="docs/media/banner.png" width="100%" alt="DiscBubble: Windows disk alanının nereye gittiğini baloncuklarla gör"></p>
<p align="center"><a href="README.md">English</a> · <b>Türkçe</b></p>

DiscBubble, Windows diskini dolduran şeyleri yakınlaştırılabilir baloncuklar olarak gösterir, neyin silinmesinin güvenli olduğunu önerir ve kullanılmayan sürücü (driver) paketlerini temizler. Kendi bilgisayarım için yaptığım kişisel bir araçtır.

<p align="center"><img src="docs/media/hero.gif" width="860" alt="DiscBubble bir demo diski tarar, klasöre yakınlaşır, dosya türüne göre renklendirir ve önerilen silmeler listesini açar"></p>

## Ne yapar

- **Baloncuk görünümü.** Her klasör ve dosya, disk kullanımıyla orantılı bir daire (canvas üzerinde D3 circle packing). Tıkla yakınlaş, Esc ile yukarı çık.
- **Üç renk modu.** Güvenlik (silinebilir, önce bak, kişisel, program, dokunma), dosya türü ve önem.
- **Temizlik önerileri.** Geçici dosya, önbellek, `node_modules`, büyük arşiv ve video için kural tabanlı liste; her öneride gerekçe var. Silme Geri Dönüşüm Kutusu'na ya da kalıcı olur; kilitli klasörde hangi programın tuttuğu söylenir (Windows Restart Manager).
- **Sürücüler sekmesi.** Driver Store'daki eski ve kullanılmayan üçüncü taraf paketleri bulur, `pnputil` ile siler (`/force` yok, kullanımdaki paketi Windows reddeder).

## Nasıl çalışır

<p align="center"><img src="docs/media/architecture.svg" width="860" alt="Mimari: public/ arayüzü, Electron main.js, Rust bubblescan tarayıcısı, sürücü ve silme yardımcıları"></p>

- `scanner-rs/src/main.rs` (`bubblescan`) iki moddur. `walk` rayon ile `read_dir` kullanır. `mft` bir sürücünün ham NTFS `$MFT` kaydını okur, yönetici hakkı ister; olmazsa uygulama `walk`'a düşer.
- Tarayıcı budanmış bir JSON ağacı döndürür (`prune()` küçük öğeleri birleştirir). `main.js` onu çalıştırıp sonucu `public/app.js`'e verir.
- `scanner.js` düz bir Node tarayıcısıdır (uygulama için sürücüleri de listeler, kıyas ölçümü onunla yapılır). `server.js` + `Disk-Bubble.cmd` eski tarayıcı kipi sunucusudur; güncel arayüz Electron köprüsüyle (`preload.js` içindeki `window.native`) konuşur ve ona bağlı değildir.
- Yaklaşım, mevcut disk araçlarının dosya tablosunu nasıl okuduğuna bakılarak şekillendi; onları REA tersine mühendislik aracıyla inceleyip fikri Rust tarayıcıda yeniden uyguladım.

## Sayılar

<p align="center"><img src="docs/media/bench.svg" width="860" alt="Çubuk grafik: 60.000 dosya için Node tarayıcı 11,5 saniye, Rust walk modu 0,124 saniye"></p>

`node bench/scan-bench.cjs 7 60000` ile 2026-10-20'de ölçüldü (Windows 11, 32 mantıksal CPU): 60.000 küçük dosyalık yapay ağaçta 7 koşunun medyanı; Node `scanner.js` 11,51 sn, `bubblescan --mode walk` 0,124 sn (süreç başlatma ve JSON yazma dahil). Ham veri: `docs/media/data/scan-bench.json`. `mft` modu ölçülmedi (yönetici hakkı ister).

## Hızlı başlangıç

Gerekenler: Windows, Node.js ve tarayıcı için Rust (`cargo`).

```
npm install
cd scanner-rs && cargo build --release && cd ..
mkdir bin && copy scanner-rs	argeteleaseubblescan.exe binnpm start
```

## Kullanım

Bir sürücü seç (hızlı `mft` taraması için yönetici olarak yeniden başlat), baloncuklara tıklayıp yakınlaş, sağ üstten renk modunu değiştir, temizlik için **Suggested deletions** ya da **Drivers** sekmesini aç.

## Sınırlar

- Yalnız Windows. Electron uygulaması `mft` modunu ancak UAC onayıyla çalıştırır; onaysız taramalar `walk` ile yapılır.
- Tarama, silme ve sürücü temizliği yalnız Electron uygulamasında çalışır; `server.js` eskidir, güncel arayüze bağlı değildir.
- Temizlik kuralları sezgiseldir. Silmeden önce listeyi gözden geçir; kalıcı silme geri alınamaz.
- Otomatik test yok; `npm test` yalnız sözdizimi denetimidir.

## Lisans

ISC (bkz. `package.json`).
