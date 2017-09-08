import * as fs from 'fs';
import * as stream from 'stream';
import * as path from 'path';
import * as url from 'url';
import * as del from 'del';
import * as gulp from 'gulp';
import * as gutil from 'gulp-util';
import * as rename from 'gulp-rename';
import * as cheerio from 'cheerio';
import * as VinylFile from 'vinyl';
import * as runsequence from 'run-sequence';

const connect = require('gulp-connect');


// Tasks
// =======================================================
gulp.task('default', ['dev']);

gulp.task('dev', function (done) {
    runsequence('build', 'watch', 'connect', done);
});

gulp.task('build', function (done) {
    runsequence('html', done);
});

gulp.task('html', function () {
    return gulp.src(['index.html'])
        .pipe(rename((path) => path.extname = '-inline.html'))
        .pipe(new InlineScripts())
        .pipe(new InlineStyles())
        .pipe(new InlineImages())
        .pipe(gulp.dest('dist'))
        .pipe(connect.reload());
});

gulp.task('connect', function () {
    connect.server({
        livereload: true,
        root: __dirname
    });
});

gulp.task('watch', function () {
    gulp.watch(['index.html'], ['build']);
});

gulp.task('clean', function () {
    return Promise.all([del('dist')]);
});


// Custom Transforms
// =======================================================

type TransformCallback = (error?: Error | null, data?: any) => void;

function readFile(path: string, encoding: string | null = 'utf8'): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let callback = (err: any, data: any) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(data);
            }
        };

        if (encoding) {
            fs.readFile(path, encoding, callback);
        }
        else {
            fs.readFile(path, callback);
        }

    });
}


abstract class HtmlTransform extends stream.Transform {

    protected abstract pluginName: string;

    constructor() {
        super({ objectMode: true });
    }

    protected abstract transformHtml(contents: string, relativePath: string): Promise<string>;

    public _transform(file: VinylFile, encoding: string, callback: TransformCallback): void {
        if (file.isNull()) {
            return callback(null, file);
        }

        if (file.isStream()) {
            this.emit('error', new gutil.PluginError(this.pluginName, 'Streams not supported!'));
        }
        else if (file.isBuffer()) {
            this.transformHtml(file.contents.toString(), file.relative).then(newHtml => {
                file.contents = new Buffer(newHtml, 'utf8');
                callback(null, file);
            })
            .catch(reason => {
                let error = new gutil.PluginError(this.pluginName, reason, {showStack: true});
                console.error(error.toString());
                callback(error as Error);
            });
        }
    }
}


class InlineScripts extends HtmlTransform {
    public pluginName: string = 'InlineScripts';

    protected transformHtml(contents: string, relative: string): Promise<string> {
        // Parse html
        let $ = cheerio.load(contents);

        // for each <script> tag with a relative url in the current file
        let scripts = $('script[src]').filter((index, element) => url.parse(element.attribs['src']).protocol == null);

        return Promise.all(Array.from(scripts).map(element => {
            let $element = $(element);
            let srcPath = path.join(path.dirname(relative), $element.attr('src'));

            // read contents of file at src attr relative to 'dist'
            return readFile(srcPath).then(srcContents => {
                // remove sourcemap line and
                // fix bug in hljs script from being inlined properly
                srcContents = srcContents
                    .replace(/\s*\/\/# sourceMappingURL=.*/g, '')
                    .replace(/"<\/script>"/g, `"</scr"+"ipt>"`);

                // place contents of file into contents of <script> tag
                $element.text(`// <![CDATA[ \r\n ${srcContents} \r\n // ]]>`);
                // remove src attr
                $element.removeAttr('src');
                // put original source as data url
                $element.attr('data-src', srcPath);
            });
        }))
        .then(() => $.html());
    }
}


class InlineStyles extends HtmlTransform {
    public pluginName: string = 'InlineStyles';

    protected transformHtml(contents: string, relative: string): Promise<string> {
        // Parse html
        let $ = cheerio.load(contents);

        // for each <link> tag with a relative url
        let styles = $('link[rel=stylesheet][href]').filter((index, element) => url.parse(element.attribs['href']).protocol == null);

        return Promise.all(Array.from(styles).map(element => {
            let $element = $(element);
            let srcPath = path.join(path.dirname(relative), $element.attr('href'));

            // read contents of file at href attr relative to 'dist'
            return readFile(srcPath).then(srcContents => {
                // remove sourcemap line
                srcContents = srcContents.replace(/\s*\/\/# sourceMappingURL=.*/g, '');

                // create <style> tag with contents of file
                let styleTag = $('<style>')
                    .attr('data-href', $element.attr('href'))
                    .attr('type', 'text/css')
                    .text(srcContents);

                // replace <link> tag with <style> tag
                $element.replaceWith(styleTag);
            });
        }))
        .then(() => $.html());
    }
}


class InlineImages extends HtmlTransform {
    public pluginName: string = 'InlineImages';

    protected transformHtml(contents: string, relative: string): Promise<string> {
        // Parse html
        let $ = cheerio.load(contents);

        // for each <link> tag with a relative url
        let images = $('img[src]').filter((index, element) => url.parse(element.attribs['src']).protocol == null);

        return Promise.all(Array.from(images).map(element => {
            let $element = $(element);
            let srcPath = path.join(path.dirname(relative), $element.attr('src'));

            // read contents of file at href attr relative to 'dist'
            return readFile(srcPath, null).then(srcContents => {
                // remove sourcemap line
                let base64 = new Buffer(srcContents).toString('base64');
                let imageExtension = path.extname(srcPath).slice(1) || 'png';
                let newSrcPath = `data:image/${imageExtension};base64,${base64}`;

                // replace <image> tag with <style> tag
                $element.attr('data-original-src', $element.attr('src'));
                $element.attr('src', newSrcPath);
            });
        }))
        .then(() => $.html());
    }
}
