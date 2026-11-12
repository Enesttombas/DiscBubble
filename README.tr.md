<p align="center"><img src="docs/media/banner.png" width="100%" alt="DiscBubble: Windows disk alanının nereye gittiğini baloncuklarla gör"></p>
<p align="center"><a href="README.md">English</a> · <b>Türkçe</b></p>

DiscBubble, Windows diskini dolduran şeyleri yakınlaştırılabilir baloncuklar olarak gösterir, neyin silinmesinin güvenli olduğunu önerir ve kullanılmayan sürücü (driver) paketlerini temizler. Kendi bilgisayarım için yaptığım kişisel bir araçtır.

<p align="center"><img src="docs/media/hero.gif" width="860" alt="DiscBubble bir demo diski tarar, güvenlik renklerine geçer, bir modeli silmenin bedelini gösterir ve önerilen silmeler listesini açar"></p>

## Ne yapar

- **Baloncuk görünümü.** Her klasör ve dosya, disk kullanımıyla orantılı bir daire (canvas üzerinde D3 circle packing). Tıkla yakınlaş, Esc ile yukarı çık.
- **Üç renk modu.** Güvenlik (güvenle silinebilir, yeniden indirilebilir, kontrol edilmeli, kişisel veri, program, sistem dosyası, sınıflandırılmamış), dosya türü ve önem. Her güvenlik kademesinde "Risk yok"tan "Kritik"e kadar bir risk düzeyi gösterilir.
- **Temizlik önerileri.** Geçici dosya, önbellek, model deposu, `node_modules`, büyük arşiv ve video için kural tabanlı liste. Her öğe silinirse ne olacağını söyler. Kilitli klasörde hangi programın tuttuğu söylenir (Windows Restart Manager).
- **Sürücüler sekmesi.** Driver Store'daki eski ve kullanılmayan üçüncü taraf paketleri bulur, `pnputil` ile siler (`/force` yok, kullanımdaki paketi Windows reddeder).

## Güvenlik kademeleri

<p align="center"><img src="docs/media/tiers.gif" width="860" alt="Üç baloncuğun üzerine gelinir: bir Hugging Face modeli (Re-downloadable, Low risk), bir geçici günlük dosyası (Safe to delete, No risk) ve büyük bir video (Review first, Medium risk); her ipucunda If deleted cümlesi"></p>

Arayüz İngilizcedir; kademe ve risk adları arayüzdeki gibi yazıldı.

| Kademe | Risk | Tipik içerik | Silinirse |
|---|---|---|---|
| Safe to delete | No risk | Geçici dosyalar, GPU ve tarayıcı önbellekleri, günlükler | Gerektiğinde kendiliğinden yeniden oluşur |
| Re-downloadable | Low risk | Modeller, paket depoları, `node_modules`, sanal ortamlar | Yeniden indirilir ya da kurulur; o zamana kadar ilgili araç çalışmaz |
| Review first | Medium risk | Büyük oyunlar, disk kalıpları, arşivler, videolar, tanınmayan önbellekler | Yeniden indirilmeden ya da yedekten dönülmeden geri gelmez |
| Personal data | High risk | Belgeler, fotoğraflar, projeler | Yalnız yedekten geri alınır |
| Program | High risk | Kurulu uygulamalar | Uygulama bozulur; onun yerine Ayarlar'dan kaldır |
| System file | Critical | Windows ve sistem dosyaları | Windows açılmayabilir ya da düzgün çalışmayabilir |
| Unclassified | Unknown | Tanınmayan içerik | Etkisi bilinmez; önce içeriğe bak |

İpucu kademeyi, risk düzeyini ve somut sonucu söyler, ör. "If deleted, 17.1 GB is downloaded again (meshforge/shape3d-2). Tools that use this model will not work until the download completes." Kurallar `public/classify.js` içinde.

<p align="center"><img src="docs/media/safety-scale.png" width="860" alt="Güvenlik renklerinde ana görünüm; yedi kademeli lejant ve kademe başına boyut"></p>

## Önerilen silmeler

<p align="center"><img src="docs/media/suggestions.png" width="860" alt="Suggested deletions penceresi: her öğede kademe, risk düzeyi, yol, yaş ve silmenin sonucu"></p>

**Suggested deletions** rozeti Safe ve Re-downloadable alanı ayrı toplar. Pencerede Safe öğeler kalıcı silinir; Re-downloadable ve daha riskli öğeler Geri Dönüşüm Kutusu'na gider ve onay kutusu silmenin bedelini tekrar yazar.

<p align="center"><img src="docs/media/recycle.gif" width="860" alt="Pencerede Re-downloadable bir model işaretlenir, Move to Recycle Bin'e basılır, sonucu yazan onay okunur, sonra Cancel"></p>

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
mkdir bin && copy scanner-rs\target\release\bubblescan.exe bin\
npm start
```

## Kullanım

Bir sürücü seç (hızlı `mft` taraması için yönetici olarak yeniden başlat), baloncuklara tıklayıp yakınlaş, sağ üstten renk modunu değiştir, temizlik için **Suggested deletions** ya da **Drivers** sekmesini aç.

## Sınırlar

- Yalnız Windows. Electron uygulaması `mft` modunu ancak UAC onayıyla çalıştırır; onaysız taramalar `walk` ile yapılır.
- Tarama, silme ve sürücü temizliği yalnız Electron uygulamasında çalışır; `server.js` eskidir, güncel arayüze bağlı değildir.
- Temizlik kuralları sezgiseldir. Silmeden önce listeyi gözden geçir; kalıcı silme geri alınamaz.
- `npm test` sözdizimi denetimine ek olarak sınıflandırmanın birim testlerini çalıştırır (`test/`, yalnız sahte ağaç verisi). `node scripts/classify-path.js <klasör>` gerçek bir klasörün kademelerini hiçbir şey silmeden yazdırır.

## Lisans

[ISC](LICENSE).
